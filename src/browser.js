#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — browser engine (token-efficient, single-browser)

   A lean alternative to Playwright MCP. Cuts three kinds of waste:
     1. Never echoes your code back — returns only the result.
     2. Freezes animations before a screenshot, so there is no
        "element is not stable" timeout or second attempt.
     3. Runs multi-step verification in one pass, one browser.

   Output is intentionally short: one line when all is well.

   Commands
     check <yol...>            open pages, report JS/network errors
     probe <yol> --get k=sel   read selector text
     eval  <yol> --js "ifade"  run an expression in the page, print the result
     shot  <yol> [--sel S]     animation-frozen screenshot
     sweep [--dir .]           scan all .html pages, print only problems
     run   <scenario.json>      multi-step scenario (most efficient)
     login                     log in and store session (reused by later calls)

   Config: .webprobe.json in the project root
══════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (_) { /* for browser commands: npm i playwright-core */ }

/* ── Config ──────────────────────────────────────────── */

function findConfig(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, '.webprobe.json');
    if (fs.existsSync(p)) return { file: p, dir };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function loadConfig() {
  const found = findConfig(process.cwd());
  const cfg = found ? JSON.parse(fs.readFileSync(found.file, 'utf8')) : {};

  /* Credentials never enter the repo: .webprobe.local.json overrides
     ve .gitignore protects it. */
  if (found) {
    const local = path.join(found.dir, '.webprobe.local.json');
    if (fs.existsSync(local)) {
      const ov = JSON.parse(fs.readFileSync(local, 'utf8'));
      Object.assign(cfg, ov, { accounts: Object.assign({}, cfg.accounts, ov.accounts) });
    }
  }
  cfg.root = cfg.root ? path.resolve(found ? found.dir : '.', cfg.root)
                      : (found ? found.dir : process.cwd());
  cfg.baseUrl = (cfg.baseUrl || 'http://127.0.0.1:8080').replace(/\/$/, '');
  cfg.sessionDir = path.join(__dirname, '.sessions');
  cfg.settle = cfg.settle == null ? 1200 : cfg.settle;
  cfg.ignore = cfg.ignore || [];
  return cfg;
}

/* Find installed Chromium (playwright download or system Chrome) */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = path.join(process.env.LOCALAPPDATA || path.join(process.env.HOME || '', '.cache'), 'ms-playwright');
  if (fs.existsSync(base)) {
    const dirs = fs.readdirSync(base).filter(d => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(base, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ]) if (fs.existsSync(p)) return p;
  return null;
}

/* ── Helpers ───────────────────────────────────────────── */

const FREEZE_CSS = `*,*::before,*::after{
  animation-duration:0s!important;animation-delay:0s!important;
  transition-duration:0s!important;transition-delay:0s!important;
  animation-iteration-count:1!important;caret-color:transparent!important}`;

/* Git Bash (MSYS) on Windows "/sayfa.html" turns the
   "C:/Program Files/Git/sayfa.html" ; recover the path. */
function unmangle(p) {
  const m = /^[A-Za-z]:[\/\\](?:Program Files(?: \(x86\))?[\/\\])?Git[\/\\](.*)$/i.exec(p);
  return m ? '/' + m[1].replace(/\\/g, '/') : p;
}

function toUrl(cfg, p) {
  const s = unmangle(String(p));
  if (/^https?:/i.test(s)) return s;
  return cfg.baseUrl + (s.startsWith('/') ? s : '/' + s);
}

function shortLabel(cfg, url) {
  return url.replace(cfg.baseUrl + '/', '').replace(/\?.*$/, '') || 'index.html';
}

function ignored(cfg, text) {
  return cfg.ignore.some(pat => text.includes(pat));
}

/* Opens the page, collects errors. Returns a summary only. */
async function visit(page, cfg, target, opts = {}) {
  const jsErrors = [];
  const netErrors = [];
  const onErr = e => jsErrors.push(String(e.message).split('\n')[0]);
  const onRes = r => {
    if (r.status() >= 400) {
      const line = r.status() + ' ' + r.url().replace(cfg.baseUrl + '/', '');
      if (!ignored(cfg, line)) netErrors.push(line);
    }
  };
  page.on('pageerror', onErr);
  page.on('response', onRes);

  let navError = null;
  try {
    await page.goto(toUrl(cfg, target), {
      waitUntil: opts.waitUntil || 'networkidle',
      timeout: opts.timeout || 25000,
    });
    await page.waitForTimeout(opts.settle == null ? cfg.settle : opts.settle);
  } catch (e) {
    navError = String(e.message).split('\n')[0];
  }

  page.off('pageerror', onErr);
  page.off('response', onRes);

  /* A late redirect can happen while the page settles; wait for
     the context before evaluating, else "execution context destroyed". */
  try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch (_) {}

  return { jsErrors, netErrors: [...new Set(netErrors)], navError, url: page.url() };
}

/* Makes the user expression runnable.
   A single expression ("document.title") as well as a multi-line body
   ("const x=1; return x") are accepted. */
function asRunnable(expr) {
  const s = String(expr).trim();

  /* Only at TOP LEVEL ";" veya "return" means a body.
     IIFE inside an IIFE, a ";" mistaken for a body yields undefined. */
  let depth = 0, quote = null, govde = false;
  for (let i = 0; i < s.length && !govde; i++) {
    const c = s[i];
    if (quote) { if (c === quote && s[i - 1] !== '\\') quote = null; continue; }

    /* Skip comments: their parens/quotes threw off the counter */
    if (c === '/' && s[i + 1] === '/') { const n = s.indexOf('\n', i); if (n < 0) break; i = n; continue; }
    if (c === '/' && s[i + 1] === '*') { const n = s.indexOf('*/', i + 2); if (n < 0) break; i = n + 1; continue; }

    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0) {
      if (c === ';' && s.slice(i + 1).trim()) govde = true;
      if (s.startsWith('return', i) && (i === 0 || /[\s;}]/.test(s[i - 1]))) govde = true;
    }
  }
  return govde ? `(async () => { ${s} })()` : `(async () => (${s}))()`;
}

/* Retries once on a late redirect. */
async function safeEval(page, arg) {
  try {
    return await page.evaluate(arg);
  } catch (e) {
    if (!/context was destroyed|Target closed|navigating/i.test(e.message)) throw e;
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    return page.evaluate(arg);
  }
}

/* Selector → text. Returns null silently if missing. */
async function readSelectors(page, map) {
  const src = `(m => {
    const out = {};
    for (const [k, sel] of Object.entries(m)) {
      const el = document.querySelector(sel);
      if (!el) { out[k] = null; continue; }
      const v = (el.value !== undefined && el.tagName === 'INPUT') ? el.value : el.innerText;
      out[k] = String(v == null ? '' : v).replace(/\\s+/g, ' ').trim().slice(0, 300);
    }
    return out;
  })(${JSON.stringify(map)})`;
  return safeEval(page, src);
}

async function runEvals(page, map) {
  const out = {};
  for (const [k, expr] of Object.entries(map)) {
    try {
      out[k] = await safeEval(page, asRunnable(expr));
    } catch (e) {
      out[k] = 'HATA: ' + String(e.message).split('\n')[0];
    }
  }
  return out;
}

function fmtValue(v) {
  if (v === null || v === undefined) return '(yok)';
  if (typeof v === 'string') return JSON.stringify(v.length > 200 ? v.slice(0, 200) + '…' : v);
  const s = JSON.stringify(v);
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

/* ── Oturum ────────────────────────────────────────────────── */

function sessionPath(cfg, name) {
  if (!fs.existsSync(cfg.sessionDir)) fs.mkdirSync(cfg.sessionDir, { recursive: true });
  const key = path.basename(cfg.root).replace(/[^a-z0-9-]/gi, '_');
  return path.join(cfg.sessionDir, key + '.' + name + '.json');
}

async function doLogin(cfg, name) {
  const acc = (cfg.accounts || {})[name];
  if (!acc) throw new Error(`account "${name}" is not defined in .webprobe.json`);

  const browser = await chromium.launch({ executablePath: findChrome() });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(toUrl(cfg, acc.loginPath || '/login.html'), { waitUntil: 'networkidle' });
  await page.fill(acc.emailSelector || '#email', acc.email);
  await page.fill(acc.passwordSelector || '#password', acc.password);
  await page.evaluate((sel) => {
    const f = sel ? document.querySelector(sel) : document.querySelector('form');
    if (f) f.requestSubmit ? f.requestSubmit() : f.submit();
  }, acc.formSelector || null);
  await page.waitForTimeout(acc.waitAfter || 3500);

  const ok = await page.evaluate(() => {
    try {
      return Object.keys(localStorage).some(k => /auth-token|supabase/i.test(k));
    } catch (_) { return false; }
  });

  await ctx.storageState({ path: sessionPath(cfg, name) });
  await browser.close();
  return ok;
}

async function makeContext(browser, cfg, as, flags) {
  const w = flags && Number(flags.width) > 0 ? Number(flags.width) : 1440;
  const h = flags && Number(flags.height) > 0 ? Number(flags.height) : 900;
  const opts = { viewport: { width: w, height: h } };
  /* At mobile width behave like a real device: touch + mobile UA */
  if (w <= 768) {
    opts.isMobile = true;
    opts.hasTouch = true;
    opts.deviceScaleFactor = 2;
    opts.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
      + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  }
  if (as) {
    const p = sessionPath(cfg, as);
    if (!fs.existsSync(p)) throw new Error(`no session for "${as}" — first: athena login ${as}`);
    opts.storageState = p;
  }
  return browser.newContext(opts);
}

/* ── Raporlama ─────────────────────────────────────────────── */

function reportVisit(label, res, out) {
  const bad = res.jsErrors.length + res.netErrors.length + (res.navError ? 1 : 0);
  out.push(`${label}  ${bad ? 'SORUN' : 'TEMIZ'}  js:${res.jsErrors.length} net:${res.netErrors.length}`);
  if (res.navError) out.push('  YUKLEME  ' + res.navError);
  res.jsErrors.forEach(e => out.push('  JS   ' + e));
  res.netErrors.forEach(e => out.push('  NET  ' + e));
  return bad;
}

/* ── Commands ──────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out.flags[key] = true;
      else { out.flags[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

/* "name=selector,name2=expr" → object.
   Skips commas inside parens/brackets/quotes; otherwise expressions
   like slice(0,80) would be split in two. */
function splitTop(str) {
  const parts = [];
  let buf = '', depth = 0, quote = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      buf += c;
      if (c === quote && str[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; buf += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

function parsePairs(str) {
  const out = {};
  if (!str || str === true) return out;
  splitTop(str).forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    else out[part.trim()] = part.trim();
  });
  return out;
}

async function cmdCheck(cfg, args) {
  const targets = args._.slice(1);
  if (!targets.length) throw new Error('usage: check <path...> [--get name=selector,...] [--as account]');

  const browser = await chromium.launch({ executablePath: findChrome() });
  const ctx = await makeContext(browser, cfg, args.flags.as, args.flags);
  const page = await ctx.newPage();
  const out = [];
  let bad = 0;

  const getMap = parsePairs(args.flags.get);
  const evalMap = parsePairs(args.flags.eval);

  for (const t of targets) {
    const res = await visit(page, cfg, t, { settle: Number(args.flags.wait) || undefined });
    bad += reportVisit(shortLabel(cfg, toUrl(cfg, t)), res, out);
    if (Object.keys(getMap).length) {
      const vals = await readSelectors(page, getMap);
      for (const [k, v] of Object.entries(vals)) out.push(`  ${k} = ${fmtValue(v)}`);
    }
    if (Object.keys(evalMap).length) {
      const vals = await runEvals(page, evalMap);
      for (const [k, v] of Object.entries(vals)) out.push(`  ${k} = ${fmtValue(v)}`);
    }
  }

  await browser.close();
  console.log(out.join('\n'));
  return bad ? 1 : 0;
}

async function cmdEval(cfg, args) {
  const target = args._[1];
  const expr = args.flags.js;
  if (!target || !expr || expr === true) throw new Error('usage: eval <path> --js "expr" [--as account]');

  const browser = await chromium.launch({ executablePath: findChrome() });
  const ctx = await makeContext(browser, cfg, args.flags.as, args.flags);
  const page = await ctx.newPage();
  const res = await visit(page, cfg, target, { settle: Number(args.flags.wait) || undefined });

  let value, err = null;
  try { value = await safeEval(page, asRunnable(expr)); }
  catch (e) { err = String(e.message).split('\n')[0]; }

  await browser.close();
  if (err) { console.log('ERROR  ' + err); return 1; }
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
  if (res.jsErrors.length) console.log('JS  ' + res.jsErrors.join(' | '));
  return 0;
}

async function cmdShot(cfg, args) {
  const target = args._[1];
  if (!target) throw new Error('usage: shot <path> [--sel selector] [--out file.png] [--full]');

  const browser = await chromium.launch({ executablePath: findChrome() });
  const ctx = await makeContext(browser, cfg, args.flags.as, args.flags);
  const page = await ctx.newPage();
  await visit(page, cfg, target, { settle: Number(args.flags.wait) || undefined });

  if (args.flags.js && args.flags.js !== true) {
    await safeEval(page, asRunnable(args.flags.js));
    await page.waitForTimeout(500);
  }
  if (args.flags.click) {
    await page.evaluate(s => document.querySelector(s)?.click(), args.flags.click);
    await page.waitForTimeout(600);
  }

  /* Freeze animations — the root of "element is not stable" timeouts */
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.waitForTimeout(120);

  const outFile = path.resolve(args.flags.out === true || !args.flags.out
    ? path.join(cfg.root, 'webprobe-shot.png') : args.flags.out);

  if (args.flags.sel && args.flags.sel !== true) {
    const el = await page.$(args.flags.sel);
    if (!el) { await browser.close(); console.log('ERROR  selector not found: ' + args.flags.sel); return 1; }
    await el.screenshot({ path: outFile, animations: 'disabled' });
  } else {
    await page.screenshot({ path: outFile, fullPage: !!args.flags.full, animations: 'disabled' });
  }

  await browser.close();
  console.log(outFile);
  return 0;
}

async function cmdSweep(cfg, args) {
  const root = args.flags.dir && args.flags.dir !== true
    ? path.resolve(args.flags.dir) : cfg.root;

  const skip = (cfg.sweepIgnore || ['node_modules', '_kaynak', '.git']);
  const pages = [];
  (function walk(dir, prefix) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.some(s => e.name === s)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, prefix + e.name + '/');
      else if (e.name.endsWith('.html')) pages.push(prefix + e.name);
    }
  })(root, '');

  const browser = await chromium.launch({ executablePath: findChrome() });
  const ctx = await makeContext(browser, cfg, args.flags.as, args.flags);
  const page = await ctx.newPage();

  const sorunlu = [];
  for (const p of pages) {
    const res = await visit(page, cfg, p, { settle: Number(args.flags.wait) || 400 });
    if (res.jsErrors.length || res.netErrors.length || res.navError) sorunlu.push([p, res]);
  }
  await browser.close();

  const out = [`Scanned: ${pages.length}  Problems: ${sorunlu.length}`];
  sorunlu.forEach(([p, res]) => reportVisit(p, res, out));
  console.log(out.join('\n'));
  return sorunlu.length ? 1 : 0;
}

/* Scenario: many steps in one pass. The most efficient mode. */
async function cmdRun(cfg, args) {
  const file = args._[1];
  if (!file) throw new Error('usage: run <scenario.json>');
  const plan = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const steps = plan.steps || [];

  const browser = await chromium.launch({ executablePath: findChrome() });
  const contexts = new Map();
  const out = [];
  let fails = 0, checks = 0;

  async function pageFor(as) {
    const key = as || '_anon';
    if (!contexts.has(key)) {
      const ctx = await makeContext(browser, cfg, as, args.flags);
      contexts.set(key, await ctx.newPage());
    }
    return contexts.get(key);
  }

  for (const step of steps) {
    const label = step.name || step.url || '(step)';
    const page = await pageFor(step.as || plan.as);

    if (step.url) {
      const res = await visit(page, cfg, step.url, { settle: step.wait });
      if (res.navError || res.jsErrors.length) {
        fails++;
        out.push(`✗ ${label}`);
        if (res.navError) out.push('   YUKLEME ' + res.navError);
        res.jsErrors.forEach(e => out.push('   JS ' + e));
        continue;
      }
      if (res.netErrors.length && step.strictNet !== false) {
        res.netErrors.forEach(e => out.push(`  ! ${label}  NET ${e}`));
      }
    }

    if (step.fill) {
      for (const [sel, val] of Object.entries(step.fill)) await page.fill(sel, String(val));
    }
    if (step.click) {
      for (const sel of [].concat(step.click)) {
        await page.evaluate(s => document.querySelector(s)?.click(), sel);
        await page.waitForTimeout(step.clickWait || 700);
      }
    }
    if (step.pause) await page.waitForTimeout(step.pause);

    const values = {};
    if (step.get)  Object.assign(values, await readSelectors(page, step.get));
    if (step.eval) Object.assign(values, await runEvals(page, step.eval));

    if (step.expect) {
      for (const [k, want] of Object.entries(step.expect)) {
        checks++;
        const got = values[k];
        const ok = typeof want === 'string' && want.startsWith('~')
          ? String(got).includes(want.slice(1))
          : JSON.stringify(got) === JSON.stringify(want);
        if (!ok) { fails++; out.push(`✗ ${label} · ${k}\n   expected ${fmtValue(want)}\n   got      ${fmtValue(got)}`); }
      }
    }

    /* no expect → show values; with expect → only failures print */
    if (!step.expect && Object.keys(values).length) {
      out.push(`· ${label}`);
      for (const [k, v] of Object.entries(values)) out.push(`   ${k} = ${fmtValue(v)}`);
    }

    if (step.shot) {
      await page.addStyleTag({ content: FREEZE_CSS });
      await page.waitForTimeout(120);
      const f = path.resolve(cfg.root, step.shot);
      if (step.shotSel) {
        const el = await page.$(step.shotSel);
        if (el) await el.screenshot({ path: f, animations: 'disabled' });
      } else await page.screenshot({ path: f, animations: 'disabled' });
      out.push(`   screenshot → ${f}`);
    }
  }

  await browser.close();
  out.unshift(fails ? `RESULT: ${fails} problems / ${checks} checks` : `RESULT: OK (${checks} checks)`);
  console.log(out.join('\n'));
  return fails ? 1 : 0;
}

/* ── Entry point ─────────────────────────────────────────── */

async function run(argv) {
  if (!chromium) { console.log('ERROR  browser engine requires playwright-core: npm i -g playwright-core (or npx playwright install chromium)'); return 1; }
  const args = parseArgs(argv);
  const cmd = args._[0];
  const cfg = loadConfig();

  const usage = `webprobe — commands:
  check <path...> [--get name=sel,...] [--eval name=expr,...] [--as account] [--wait ms]
  eval  <path> --js "expr" [--as account]
  shot  <path> [--sel selector] [--out file] [--full] [--click selector] [--as account]
  sweep [--dir folder] [--as account]
  run   <scenario.json>
  login <account>`;

  try {
    let code = 0;
    switch (cmd) {
      case 'check': code = await cmdCheck(cfg, args); break;
      case 'eval':  code = await cmdEval(cfg, args);  break;
      case 'shot':  code = await cmdShot(cfg, args);  break;
      case 'sweep': code = await cmdSweep(cfg, args); break;
      case 'run':   code = await cmdRun(cfg, args);   break;
      case 'login': {
        const name = args._[1] || 'admin';
        const ok = await doLogin(cfg, name);
        console.log(ok ? `session saved: ${name}` : `UYARI: ${name} no session token appeared for`);
        code = ok ? 0 : 1;
        break;
      }
      default: console.log(usage); code = cmd ? 1 : 0;
    }
    return code;
  } catch (e) {
    console.log('ERROR  ' + String(e.message).split('\n')[0]);
    return 1;
  }
}

module.exports = { run };
