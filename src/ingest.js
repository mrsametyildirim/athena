'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — Knowledge Ingestion (NotebookLM-like, offline core)

   Takes a document (docx/xlsx/pptx/pdf/media/image/code/log),
   extracts its structure and turns it into an Athena note: summary,
   key points, heading map, source attribution. Raw documents get
   "absorbed" into memory and can be linked with [[wiki-links]].

   Works offline (no service needed). Optional: with ANTHROPIC_API_KEY
   set, `--ai` adds a Claude summary.
══════════════════════════════════════════════════════════════ */

const U = require('./util');
const { fs, path } = U;

function keyPoints(text) {
  const lines = text.split('\n');
  const bullets = lines.filter(l => /^\s*[-*•]\s+\S/.test(l)).map(l => l.replace(/^\s*[-*•]\s+/, '').trim());
  const bold = [...text.matchAll(/\*\*([^*]{4,80})\*\*/g)].map(m => m[1].trim());
  const headings = lines.filter(l => /^#{1,4}\s+\S/.test(l)).map(l => l.replace(/^#+\s+/, '').trim());
  const sentences = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/)
    .filter(s => s.length > 40 && s.length < 220).slice(0, 5);
  return { bullets: uniq(bullets).slice(0, 12), bold: uniq(bold).slice(0, 8),
           headings: uniq(headings).slice(0, 15), sentences };
}
function uniq(a) { return [...new Set(a)]; }

async function aiSummary(text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const body = JSON.stringify({
      model: 'claude-sonnet-5', max_tokens: 500,
      messages: [{ role: 'user', content:
        'Summarize the following document into 3-5 bullet points suitable for permanent memory. Output only the bullets:\n\n' + text.slice(0, 12000) }],
    });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body,
    });
    const j = await res.json();
    return (j.content && j.content[0] && j.content[0].text) || null;
  } catch (_) { return null; }
}

async function ingest(args) {
  const src = args._[0];
  if (!src) { U.err('usage: athena ingest <file> [--title "..."] [--tag a,b] [--ai]'); return 1; }
  if (!fs.existsSync(src)) { U.err('file not found: ' + src); return 1; }

  /* Read any file type: docx/xlsx/pptx/pdf/media/image/text. */
  const readers = require('./readers');
  const doc = readers.read(src);
  const raw = doc.text || '';
  const title = (args.flags.title && args.flags.title !== true) ? args.flags.title
    : path.basename(src).replace(/\.[^.]+$/, '');
  const kp = keyPoints(raw);

  let body = `# ${title}\n\n`;
  const extra = Object.entries(doc.meta || {})
    .filter(([k, v]) => v && !['file', 'bytes', 'ext'].includes(k))
    .map(([k, v]) => `${k}=${v}`).join(' · ');
  body += `**Source:** \`${src}\` · type \`${doc.kind}\` · ${raw.length.toLocaleString()} chars`
        + (extra ? ' · ' + extra : '') + ` · ingested ${new Date().toISOString().slice(0, 10)}\n\n`;
  if (doc.kind === 'media' || doc.kind === 'image' || doc.kind === 'binary') {
    body += doc.text + '\n\n';   // media/image already a structured summary
  }

  if (args.flags.ai) {
    U.info('requesting Claude summary…');
    const ai = await aiSummary(raw);
    if (ai) body += '## Summary (AI)\n' + ai.trim() + '\n\n';
    else U.warn('no AI summary (ANTHROPIC_API_KEY missing or error) — using offline extraction.');
  }

  if (kp.headings.length) body += '## Heading map\n' + kp.headings.map(h => '- ' + h).join('\n') + '\n\n';
  if (kp.bullets.length)  body += '## Key points\n' + kp.bullets.map(b => '- ' + b).join('\n') + '\n\n';
  if (kp.bold.length)     body += '## Highlights\n' + kp.bold.map(b => '- **' + b + '**').join('\n') + '\n\n';
  if (kp.sentences.length && !kp.bullets.length) body += '## Notable sentences\n' + kp.sentences.map(s => '- ' + s).join('\n') + '\n\n';
  body += '## Links\n<!-- Link related notes here with [[note-name]] -->\n';

  const dir = U.ensureVault();
  const slug = U.slugify(title);
  const file = path.join(dir, slug + '.md');
  const meta = {
    name: slug, description: 'Ingested document: ' + title, type: 'reference',
    tags: args.flags.tag && args.flags.tag !== true ? String(args.flags.tag).split(',').map(s => s.trim()) : ['ingested'],
    created: new Date().toISOString(), source: src,
  };
  fs.writeFileSync(file, U.stringifyNote(meta, body));
  const n = U.rebuildIndex();
  U.ok(`ingested → ${U.paint('bold', slug)}  ${U.dim('(' + n + ' notes)')}`);
  U.info(`${kp.headings.length} headings · ${kp.bullets.length} bullets · ${kp.bold.length} highlights extracted`);
  U.info('note: ' + U.dim(file));
  return 0;
}

module.exports = { ingest };
