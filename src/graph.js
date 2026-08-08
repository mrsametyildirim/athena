'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — Knowledge Map

   Builds a link graph from the [[wiki-links]] between notes.
   - Most central notes (most incoming links)
   - Orphan (unlinked) notes
   - Missing links: [[X]] referenced but note X does not exist yet
     → a signal of knowledge worth writing (Obsidian's "unresolved
     link" idea)
   - mermaid diagram export
══════════════════════════════════════════════════════════════ */

const U = require('./util');

function build() {
  const notes = U.allNotes();
  const names = new Set(notes.map(n => n.name));
  const incoming = {};        // target -> link count
  const edges = [];
  const missing = {};         // unwritten targets
  notes.forEach(n => {
    n.links.forEach(l => {
      const target = U.slugify(l);
      edges.push([n.name, target]);
      incoming[target] = (incoming[target] || 0) + 1;
      if (!names.has(target)) missing[target] = (missing[target] || 0) + 1;
    });
  });
  return { notes, names, incoming, edges, missing };
}

function map(args) {
  const g = build();
  if (!g.notes.length) { U.warn('vault is empty.'); return 0; }

  if (args.flags.mermaid) {
    console.log('```mermaid\ngraph LR');
    g.edges.forEach(([a, b]) => console.log(`  ${a.replace(/[^\w]/g, '_')}["${a}"] --> ${b.replace(/[^\w]/g, '_')}["${b}"]`));
    console.log('```');
    return 0;
  }

  const central = Object.entries(g.incoming)
    .filter(([t]) => g.names.has(t))
    .sort((a, b) => b[1] - a[1]).slice(0, 8);
  const orphans = g.notes.filter(n => n.links.length === 0 && !g.incoming[n.name]);
  const missing = Object.entries(g.missing).sort((a, b) => b[1] - a[1]);

  U.info(`${g.notes.length} notes · ${g.edges.length} links\n`);

  if (central.length) {
    console.log(U.paint('bold', '  ◆ Most central notes (knowledge hubs)'));
    central.forEach(([t, c]) => console.log('    ' + U.paint('cyan', t.padEnd(34)) + U.dim('← ' + c + ' links')));
    console.log('');
  }
  if (missing.length) {
    console.log(U.paint('bold', '  ✎ Missing links (knowledge to write)'));
    missing.slice(0, 10).forEach(([t, c]) => console.log('    ' + U.paint('yellow', t.padEnd(34)) + U.dim('× ' + c + ' refs → no note yet')));
    console.log('');
  }
  if (orphans.length) {
    console.log(U.paint('bold', '  ○ Orphan notes (no links)'));
    orphans.slice(0, 10).forEach(n => console.log('    ' + U.dim(n.name)));
    console.log('');
  }
  U.ok('map ready · mermaid: ' + U.dim('athena map --mermaid'));
  return 0;
}

module.exports = { map, build };
