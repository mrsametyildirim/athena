'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — Memory Engine (Obsidian-like, standalone)

   Every piece of knowledge is a markdown note: YAML frontmatter +
   body + [[wiki-links]]. The vault is a plain folder, tied to no
   application. Notes open in any editor, version with git, move
   anywhere.
══════════════════════════════════════════════════════════════ */

const U = require('./util');
const { fs, path } = U;

/* remember: save new knowledge (or update a note with the same name) */
function remember(args) {
  const title = args._[0];
  if (!title) { U.err('usage: athena remember "<title>" [--tag a,b] [--type user|feedback|project|reference] [--body "..."]'); return 1; }
  const dir = U.ensureVault();
  const slug = U.slugify(title);
  const file = path.join(dir, slug + '.md');

  let body = args.flags.body && args.flags.body !== true ? String(args.flags.body) : '';
  if (!body && !process.stdin.isTTY) {
    try { body = fs.readFileSync(0, 'utf8'); } catch (_) {}
  }
  const meta = {
    name: slug,
    description: (args.flags.desc && args.flags.desc !== true ? args.flags.desc : title),
    type: (args.flags.type && args.flags.type !== true ? args.flags.type : 'reference'),
    tags: args.flags.tag && args.flags.tag !== true ? String(args.flags.tag).split(',').map(s => s.trim()) : [],
    created: new Date().toISOString(),
  };
  if (fs.existsSync(file)) {
    const prev = U.parseNote(fs.readFileSync(file, 'utf8'));
    meta.created = prev.meta.created || meta.created;
    meta.updated = new Date().toISOString();
    if (!body) body = prev.body;   // keep body if none supplied
  }
  fs.writeFileSync(file, U.stringifyNote(meta, body || '# ' + title + '\n\n'));
  const n = U.rebuildIndex();
  U.ok(`saved: ${U.paint('bold', slug)}  ${U.dim('(' + n + ' notes)')}`);
  U.info('edit: ' + U.dim(file));
  return 0;
}

/* recall: search across title + body + tags */
function recall(args) {
  const q = (args._[0] || '').toLowerCase();
  if (!q) { U.err('usage: athena recall "<query>" [--tag x] [--limit N]'); return 1; }
  const limit = Number(args.flags.limit) || 10;
  const tag = args.flags.tag && args.flags.tag !== true ? String(args.flags.tag).toLowerCase() : null;
  const notes = U.allNotes();
  const scored = [];
  for (const n of notes) {
    if (tag && !(Array.isArray(n.meta.tags) ? n.meta.tags : [n.meta.tags]).map(String).some(t => t.toLowerCase() === tag)) continue;
    const hay = (n.name + ' ' + (n.meta.description || '') + ' ' + n.body).toLowerCase();
    let score = 0;
    if (n.name.toLowerCase().includes(q)) score += 5;
    if ((n.meta.description || '').toLowerCase().includes(q)) score += 3;
    const occ = hay.split(q).length - 1;
    score += occ;
    if (score > 0) scored.push({ n, score, occ });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) { U.warn('no match: ' + q); return 0; }
  U.info(`${scored.length} results (top ${Math.min(limit, scored.length)}):\n`);
  scored.slice(0, limit).forEach(({ n, occ }) => {
    const line = n.body.split('\n').find(l => l.toLowerCase().includes(q)) || n.meta.description || '';
    console.log('  ' + U.paint('bold', n.name) + '  ' + U.dim('×' + (occ || 1)));
    console.log('  ' + U.dim(line.trim().slice(0, 100)) + '\n');
  });
  return 0;
}

/* show: print a note */
function show(args) {
  const name = U.slugify(args._[0] || '');
  const file = path.join(U.vaultDir(), name + '.md');
  if (!fs.existsSync(file)) { U.err('note not found: ' + name); return 1; }
  process.stdout.write(fs.readFileSync(file, 'utf8'));
  return 0;
}

/* forget: delete a note */
function forget(args) {
  const name = U.slugify(args._[0] || '');
  const file = path.join(U.vaultDir(), name + '.md');
  if (!fs.existsSync(file)) { U.err('note not found: ' + name); return 1; }
  fs.unlinkSync(file);
  U.rebuildIndex();
  U.ok('deleted: ' + name);
  return 0;
}

/* list: all notes */
function list() {
  const notes = U.allNotes().sort((a, b) => (b.meta.created || '').localeCompare(a.meta.created || ''));
  if (!notes.length) { U.warn('vault is empty. First note: athena remember "..."'); return 0; }
  U.info(`${notes.length} notes · ${U.dim(U.vaultDir())}\n`);
  notes.forEach(n => {
    const tags = (Array.isArray(n.meta.tags) ? n.meta.tags : []).filter(Boolean);
    console.log('  ' + U.paint('bold', n.name.padEnd(34)) + ' '
      + U.dim((n.meta.type || '').padEnd(10)) + ' '
      + U.paint('cyan', tags.map(t => '#' + t).join(' ')));
  });
  return 0;
}

module.exports = { remember, recall, show, forget, list };
