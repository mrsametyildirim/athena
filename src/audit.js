'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — Security Audit (static, dependency-free)

   Scans a codebase and reports leaked secrets, dangerous patterns
   and misconfiguration. Rules distilled from real audits:
   "never trust the client for anything of value" + secret leakage
   + injection surfaces.
══════════════════════════════════════════════════════════════ */

const U = require('./util');
const { fs, path } = U;

const RULES = [
  { id: 'secret-service-role', sev: 'CRITICAL', re: /service_role|SUPABASE_SERVICE_ROLE/,
    msg: 'Supabase service_role key — must never reach the client/repo' },
  { id: 'secret-sbp', sev: 'CRITICAL', re: /sbp_[A-Za-z0-9]{20,}/,
    msg: 'Supabase management token leak' },
  { id: 'secret-aws', sev: 'CRITICAL', re: /AKIA[0-9A-Z]{16}/,
    msg: 'AWS access key leak' },
  { id: 'secret-privatekey', sev: 'CRITICAL', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    msg: 'Private key embedded' },
  { id: 'secret-smtp', sev: 'HIGH', re: /xsmtpsib-[a-f0-9]{40,}|xkeysib-[a-f0-9]{40,}/,
    msg: 'Brevo/SMTP key leak' },
  { id: 'secret-generic', sev: 'HIGH', re: /(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
    msg: 'Hardcoded credential (static key/password)' },
  { id: 'sql-concat', sev: 'HIGH', re: /(query|execute)\s*\(\s*[`'"].*\+\s*\w+/i,
    msg: 'SQL string concatenation — injection risk (use parameters)' },
  { id: 'dom-innerhtml', sev: 'MEDIUM', re: /\.innerHTML\s*=\s*[^'"`]*(\+|\$\{|user|input|param|data)/i,
    msg: 'dynamic data into innerHTML — XSS surface (use textContent or escape)' },
  { id: 'eval-use', sev: 'MEDIUM', re: /(^|[^.\w])eval\s*\(|new Function\s*\(/,
    msg: 'eval / new Function — code-injection surface' },
  { id: 'http-url', sev: 'LOW', re: /["'`]http:\/\/(?!localhost|127\.0\.0\.1)[a-z]/i,
    msg: 'Insecure http:// link' },
  { id: 'cors-any', sev: 'MEDIUM', re: /Access-Control-Allow-Origin['"]?\s*[:=]\s*['"]\*/,
    msg: 'CORS "*" — no origin restriction' },
];

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'vendor', '.bilge']);
const TEXT_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|html|css|sql|json|env|yml|yaml|py|php|rb|go|java|sh|md|txt)$/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.env') { if (IGNORE_DIRS.has(e.name)) continue; }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(full, out); }
    else if (TEXT_EXT.test(e.name)) out.push(full);
  }
  return out;
}

function audit(args) {
  const root = path.resolve(args._[0] || '.');
  if (!fs.existsSync(root)) { U.err('path not found: ' + root); return 1; }
  const files = fs.statSync(root).isDirectory() ? walk(root) : [root];
  const sevRank = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
  const findings = [];
  for (const f of files) {
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    if (text.length > 2_000_000) continue;
    const lines = text.split('\n');
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        // skip rule explanations that live in comments
        if (/safe|never|example|placeholder|<your|xxxx|dummy/i.test(line) && rule.id.startsWith('secret')) return;
        // skip the rule's own definition line (the scanner's source)
        if (/\bre:\s*\/|\bid:\s*['"]secret/.test(line)) return;
        if (rule.re.test(line)) findings.push({ file: path.relative(root, f), line: i + 1, rule, text: line.trim().slice(0, 100) });
      });
    }
  }
  findings.sort((a, b) => sevRank[a.rule.sev] - sevRank[b.rule.sev]);

  U.info(`${files.length} files scanned · ${U.dim(root)}\n`);
  if (!findings.length) { U.ok('clean — no known secret/vulnerability pattern found.'); return 0; }

  const sevColor = { 'CRITICAL': 'red', 'HIGH': 'red', 'MEDIUM': 'yellow', 'LOW': 'gray' };
  const counts = {};
  findings.forEach(f => counts[f.rule.sev] = (counts[f.rule.sev] || 0) + 1);
  for (const f of findings.slice(0, 60)) {
    console.log('  ' + U.paint(sevColor[f.rule.sev], '[' + f.rule.sev + ']') + ' '
      + U.paint('bold', f.file + ':' + f.line) + '  ' + f.rule.msg);
    console.log('    ' + U.dim(f.text));
  }
  console.log('');
  const summary = Object.entries(counts).map(([s, c]) => `${c} ${s}`).join(' · ');
  U.warn(`${findings.length} findings: ${summary}`);
  return findings.some(f => f.rule.sev === 'CRITICAL') ? 2 : 1;
}

module.exports = { audit, RULES };
