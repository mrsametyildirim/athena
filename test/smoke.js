'use strict';
const { execFileSync } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');
const bin = path.join(__dirname, '..', 'bin', 'athena.js');
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'bilge-'));
const env = { ...process.env, ATHENA_VAULT: vault, NO_COLOR: '1' };
const run = (...a) => execFileSync('node', [bin, ...a], { env, encoding: 'utf8' });
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

t('version', () => assert(/\d+\.\d+\.\d+/.test(run('version'))));
t('remember', () => assert(/saved/.test(run('remember', 'test note', '--body', 'body [[linked-note]]'))));
t('recall finds', () => assert(/test note|test-note/.test(run('recall', 'test'))));
t('list', () => assert(/test-note/.test(run('list'))));
t('map missing link', () => assert(/linked-note/.test(run('map'))));
t('ingest', () => { const f = path.join(vault, '_d.md'); fs.writeFileSync(f, '# X\n- a\n- b\n'); assert(/ingested/.test(run('ingest', f))); });
t('audit clean dir', () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-')); fs.writeFileSync(path.join(d, 'a.js'), 'const x=1;\n'); assert(/clean|findings/.test(run('audit', d))); });
t('find name', () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f-')); fs.writeFileSync(path.join(d, 'report.txt'), 'x'); assert(/report\.txt/.test(run('find', '*.txt', '--in', d))); });
t('find content', () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-')); fs.writeFileSync(path.join(d, 'a.txt'), 'the secret is here'); assert(/secret|a\.txt/.test(run('find', 'secret', '--in', d, '--content'))); });
t('readers xlsx (standalone ZIP)', () => {
  const zlib = require('zlib');
  // minimal xlsx (one sheet + shared string) — pure-JS ZIP
  const files = { 'xl/sharedStrings.xml': '<sst><si><t>Merhaba</t></si></sst>',
                  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>' };
  const chunks = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), comp = zlib.deflateRawSync(data);
    const nameB = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
    chunks.push(lh, nameB, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nameB); off += lh.length + nameB.length + comp.length;
  }
  const cdStart = off; const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(cdStart, 16);
  const xlsx = path.join(vault, 't.xlsx'); fs.writeFileSync(xlsx, Buffer.concat([...chunks, cd, eocd]));
  const doc = require('../src/readers').read(xlsx);
  assert(doc.kind === 'xlsx' && /Merhaba/.test(doc.text), 'xlsx text: ' + doc.text.slice(0, 40));
});
t('forget', () => assert(/deleted/.test(run('forget', 'test note'))));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
