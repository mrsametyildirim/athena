'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — PC File Finder

   Searches the filesystem by name or by content. Token-thrifty:
   prints only matching paths (and the matching line if asked).
     athena find "*.pdf"                   by name pattern
     athena find report --in ~/Documents   from a specific root
     athena find "TODO" --content          search inside file CONTENT
══════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const os = require('os');
const U = require('./util');

const SKIP = new Set(['node_modules', '.git', '.cache', 'AppData', '$Recycle.Bin',
  'Windows', 'Program Files', 'Program Files (x86)', '.npm', '.athena', 'dist', 'build']);

function globToRe(g) {
  return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function find(args) {
  const pattern = args._[0];
  if (!pattern) { U.err('usage: athena find "<pattern>" [--in <root>] [--content] [--limit N] [--ext pdf,docx]'); return 1; }
  const root = path.resolve(expandHome(args.flags.in && args.flags.in !== true ? args.flags.in : '.'));
  const limit = Number(args.flags.limit) || 100;
  const contentMode = !!args.flags.content;
  const exts = args.flags.ext && args.flags.ext !== true
    ? String(args.flags.ext).split(',').map(e => e.replace(/^\./, '').toLowerCase()) : null;
  const nameRe = contentMode ? null : (pattern.includes('*') || pattern.includes('?') ? globToRe(pattern) : null);
  const needle = pattern.toLowerCase();

  const hits = [];
  const t0 = Date.now();
  let scanned = 0;

  (function walk(dir, depth) {
    if (hits.length >= limit || depth > 12) return;
    let items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const it of items) {
      if (hits.length >= limit) return;
      if (it.isDirectory()) {
        if (SKIP.has(it.name) || it.name.startsWith('.')) continue;
        walk(path.join(dir, it.name), depth + 1);
      } else {
        scanned++;
        const full = path.join(dir, it.name);
        if (exts && !exts.includes(path.extname(it.name).slice(1).toLowerCase())) continue;
        if (contentMode) {
          if (!/\.(txt|md|js|ts|py|json|csv|html?|css|sql|log|ya?ml|xml|c|cpp|go|rs|java|sh|env)$/i.test(it.name)) continue;
          let text; try { const st = fs.statSync(full); if (st.size > 5_000_000) continue; text = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
          const idx = text.toLowerCase().indexOf(needle);
          if (idx >= 0) {
            const line = (text.slice(0, idx).match(/\n/g) || []).length + 1;
            const snippet = text.split('\n')[line - 1].trim().slice(0, 90);
            hits.push({ full, line, snippet });
          }
        } else {
          const match = nameRe ? nameRe.test(it.name) : it.name.toLowerCase().includes(needle);
          if (match) hits.push({ full });
        }
      }
    }
  })(root, 0);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  U.info(`${hits.length} matches · ${scanned} files scanned · ${dt}s · ${U.dim(root)}\n`);
  hits.forEach(h => {
    if (h.line) { console.log('  ' + U.paint('bold', path.relative(root, h.full)) + U.dim(':' + h.line)); console.log('    ' + U.dim(h.snippet)); }
    else console.log('  ' + path.relative(root, h.full));
  });
  if (hits.length >= limit) U.warn(`showing first ${limit} results (raise with --limit)`);
  return 0;
}

module.exports = { find };
