'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/* ── Colored terminal output (dependency-free) ────────────────── */
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const noColor = process.env.NO_COLOR || !process.stdout.isTTY;
function paint(color, s) { return noColor ? s : C[color] + s + C.reset; }
const ok   = s => console.log(paint('green', '✓ ') + s);
const info = s => console.log(paint('cyan', '• ') + s);
const warn = s => console.log(paint('yellow', '! ') + s);
const err  = s => console.error(paint('red', '✗ ') + s);
const dim  = s => paint('gray', s);

/* ── Config & vault path ───────────────────────────────────────
   Priority: ATHENA_VAULT/BILGE_VAULT env > ./.athena/vault (project)
   > ~/.athena/vault */
function vaultDir() {
  if (process.env.ATHENA_VAULT) return path.resolve(process.env.ATHENA_VAULT);
  if (process.env.BILGE_VAULT) return path.resolve(process.env.BILGE_VAULT);
  const local = path.resolve('.athena', 'vault');
  if (fs.existsSync(path.dirname(local))) return local;
  return path.join(os.homedir(), '.athena', 'vault');
}
function ensureVault() {
  const dir = vaultDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ── Slug: safe filename from a title ─────────────────────────── */
function slugify(s) {
  const tr = { 'ç':'c','ğ':'g','ı':'i','İ':'i','ö':'o','ş':'s','ü':'u',
               'Ç':'c','Ğ':'g','Ö':'o','Ş':'s','Ü':'u' };
  return String(s).trim()
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, m => tr[m] || m)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'note';
}

/* ── Minimal YAML frontmatter read/write ──────────────────────── */
function parseNote(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split('\n').forEach(line => {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) {
      let v = kv[2].trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
      meta[kv[1]] = v;
    }
  });
  return { meta, body: m[2] };
}
function stringifyNote(meta, body) {
  const lines = Object.entries(meta).map(([k, v]) =>
    `${k}: ${Array.isArray(v) ? '[' + v.join(', ') + ']' : v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

/* ── Extract [[wiki-links]] ────────────────────────────────────── */
function extractLinks(body) {
  const out = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = re.exec(body))) out.push(m[1].trim());
  return [...new Set(out)];
}

/* ── Read all notes in the vault ───────────────────────────────── */
function allNotes() {
  const dir = vaultDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
    .map(f => {
      const full = path.join(dir, f);
      const raw = fs.readFileSync(full, 'utf8');
      const { meta, body } = parseNote(raw);
      return { file: f, path: full, name: f.replace(/\.md$/, ''), meta, body,
               links: extractLinks(body) };
    });
}

/* ── Rebuild the MEMORY.md index ──────────────────────────────── */
function rebuildIndex() {
  const dir = ensureVault();
  const notes = allNotes().sort((a, b) => (b.meta.created || '').localeCompare(a.meta.created || ''));
  const byType = {};
  notes.forEach(n => {
    const t = (n.meta.type || 'note');
    (byType[t] = byType[t] || []).push(n);
  });
  let md = '# Athena Memory Index\n\n';
  md += `> ${notes.length} notes · updated ${new Date().toISOString().slice(0, 10)}\n\n`;
  for (const [type, list] of Object.entries(byType)) {
    md += `## ${type}\n`;
    list.forEach(n => {
      const hook = (n.meta.description || n.body.split('\n').find(l => l.trim()) || '').slice(0, 90);
      md += `- [[${n.name}]] — ${hook}\n`;
    });
    md += '\n';
  }
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), md);
  return notes.length;
}

module.exports = {
  C, paint, ok, info, warn, err, dim,
  vaultDir, ensureVault, slugify,
  parseNote, stringifyNote, extractLinks, allNotes, rebuildIndex,
  fs, path, os,
};
