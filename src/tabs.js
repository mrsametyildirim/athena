'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — Live Browser Control (CDP)

   Connects to an ALREADY-OPEN Chrome/Edge (does not launch a new
   browser) to read/navigate/drive tabs. Chrome must be running with
   the remote debugging port open:

     chrome --remote-debugging-port=9222
     (Athena: `athena tabs --launch` starts it for you)

   Commands:
     athena tabs                          list open tabs
     athena tabs --goto <url> [--tab N]   navigate a tab
     athena tabs --open <url>             open a new tab
     athena tabs --eval "expr" [--tab N]  run JS in a tab (task)
     athena tabs --text [--tab N]         read a tab's visible text
     athena tabs --shot <file> [--tab N]  screenshot
     athena tabs --close <N>              close a tab
     athena tabs --launch                 open Chrome with debug port
══════════════════════════════════════════════════════════════ */

const U = require('./util');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) {}

const PORT = process.env.ATHENA_CDP_PORT || process.env.BILGE_CDP_PORT || 9222;
const ENDPOINT = `http://127.0.0.1:${PORT}`;

function findChrome() {
  const cands = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const c of cands) { if (c.includes('/') ? fs.existsSync(c) : true) return c; }
  return cands[0];
}

function launch() {
  const exe = findChrome();
  const prof = path.join(os.tmpdir(), 'athena-chrome-profile');
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check'],
    { detached: true, stdio: 'ignore' });
  child.unref();
  U.ok(`Chrome started with debug port (:${PORT}).`);
  U.info('Now run: ' + U.dim('athena tabs') + ' to list tabs.');
  return 0;
}

async function tabs(args) {
  if (args.flags.launch) return launch();
  if (!chromium) { U.err('CDP needs playwright-core: npm i -g playwright-core'); return 1; }

  let browser;
  try { browser = await chromium.connectOverCDP(ENDPOINT, { timeout: 4000 }); }
  catch (_) {
    U.err(`could not connect to an open browser (:${PORT}).`);
    U.info('Fix: ' + U.dim('athena tabs --launch') + '  (opens Chrome with the debug port)');
    return 1;
  }

  try {
    const ctxs = browser.contexts();
    const pages = [];
    for (const c of ctxs) for (const p of c.pages()) pages.push(p);
    const pick = () => {
      const i = Number(args.flags.tab);
      return Number.isInteger(i) && pages[i] ? pages[i] : pages[0];
    };

    if (Object.keys(args.flags).length === 0) {
      U.info(`${pages.length} open tabs:\n`);
      for (let i = 0; i < pages.length; i++) {
        let title = ''; try { title = await pages[i].title(); } catch (_) {}
        console.log('  ' + U.paint('bold', '[' + i + ']') + ' ' + (title || '(untitled)').slice(0, 60));
        console.log('      ' + U.dim(pages[i].url().slice(0, 90)));
      }
      return 0;
    }

    if (args.flags.open && args.flags.open !== true) {
      const ctx = ctxs[0] || await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(String(args.flags.open), { waitUntil: 'domcontentloaded' }).catch(() => {});
      U.ok('new tab: ' + args.flags.open);
      return 0;
    }
    if (args.flags.goto && args.flags.goto !== true) {
      const p = pick(); if (!p) { U.err('no tab'); return 1; }
      await p.goto(String(args.flags.goto), { waitUntil: 'domcontentloaded' }).catch(() => {});
      U.ok('navigated: ' + args.flags.goto + '  ' + U.dim('(' + (await p.title().catch(() => '') ) + ')'));
      return 0;
    }
    if (args.flags.eval && args.flags.eval !== true) {
      const p = pick(); if (!p) { U.err('no tab'); return 1; }
      /* Playwright evaluates the expression in the page context;
         no new Function (so no code-injection surface). */
      const val = await p.evaluate('(' + String(args.flags.eval) + ')').catch(e => 'ERROR: ' + e.message);
      console.log(typeof val === 'object' ? JSON.stringify(val, null, 1) : String(val));
      return 0;
    }
    if (args.flags.text) {
      const p = pick(); if (!p) { U.err('no tab'); return 1; }
      const txt = await p.evaluate(() => document.body.innerText).catch(() => '');
      process.stdout.write(txt.replace(/\n{3,}/g, '\n\n').slice(0, 20000));
      return 0;
    }
    if (args.flags.shot && args.flags.shot !== true) {
      const p = pick(); if (!p) { U.err('no tab'); return 1; }
      await p.screenshot({ path: path.resolve(String(args.flags.shot)), fullPage: !!args.flags.full });
      U.ok('screenshot → ' + args.flags.shot);
      return 0;
    }
    if (args.flags.close !== undefined) {
      const i = Number(args.flags.close);
      if (pages[i]) { await pages[i].close(); U.ok('tab closed: ' + i); }
      else U.err('no tab: ' + i);
      return 0;
    }
    return await tabs({ _: [], flags: {} });
  } finally {
    try { await browser.close(); } catch (_) {}   // CDP: detaches, does NOT close the browser
  }
}

module.exports = { tabs };
