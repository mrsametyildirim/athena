'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — Multi-format Reader

   Turns any file type into text/knowledge. Text-based formats
   (docx/xlsx/pptx/csv/json/code) are read fully dependency-free —
   ZIP is unpacked with Node's own zlib. Media (mp4/mp3/wav) and PDF
   are enriched if a system tool exists (ffprobe/pdftotext); if not,
   a safe summary is returned. No cloud calls ever.
══════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

/* ── Minimal ZIP reader (docx/xlsx/pptx are ZIP) ───────────────
   Finds the End-of-Central-Directory, reads entries, inflates
   deflated ones with inflateRaw. Dependency-free. */
function readZipEntries(buf) {
  const entries = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return entries;
  const cdCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    try {
      entries[name] = method === 0 ? comp : zlib.inflateRawSync(comp);
    } catch (_) { /* skip */ }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function xmlText(xml) {
  return String(xml)
    .replace(/<\/w:p>|<\/a:p>|<\/text:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function have(cmd) {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}
function tryRun(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (_) { return null; }
}

/* ── Pure-JS media metadata (no ffprobe) ───────────────────────
   MP4/MOV: timescale+duration from moov→mvhd; resolution from tkhd.
   MP3: skip ID3, read bitrate from first frame header → CBR estimate.
   WAV: fmt chunk. */
function pureMediaMeta(file, ext) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const out = {};
  try {
    if (/\.(mp4|mov|m4a)$/i.test(ext)) {
      const buf = Buffer.alloc(Math.min(size, 2 * 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, 0);
      const idxMvhd = buf.indexOf('mvhd');
      if (idxMvhd > 0) {
        const p = idxMvhd + 4; const ver = buf[p];
        const ts = buf.readUInt32BE(p + (ver === 1 ? 20 : 12));
        const dur = ver === 1 ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
        if (ts) out.duration = Math.round(dur / ts) + ' s';
      }
      const idxTkhd = buf.indexOf('tkhd');
      if (idxTkhd > 0) {
        const p = idxTkhd + 4; const ver = buf[p];
        const wpos = p + (ver === 1 ? 96 : 84);
        const w = buf.readUInt16BE(wpos), h = buf.readUInt16BE(wpos + 4);
        if (w && h) out.video = `${w}x${h}`;
      }
    } else if (/\.mp3$/i.test(ext)) {
      const head = Buffer.alloc(4096); fs.readSync(fd, head, 0, 4096, 0);
      let off = 0;
      if (head.slice(0, 3).toString() === 'ID3') off = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]);
      const fh = Buffer.alloc(4); fs.readSync(fd, fh, 0, 4, off);
      if (fh[0] === 0xff && (fh[1] & 0xe0) === 0xe0) {
        const brIdx = (fh[2] >> 4) & 0x0f;
        const rates = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
        const kbps = rates[brIdx];
        if (kbps) { out.bitrate = kbps + ' kbps'; out.duration = Math.round((size * 8) / (kbps * 1000)) + ' s (est.)'; }
      }
    } else if (/\.wav$/i.test(ext)) {
      const b = Buffer.alloc(64); fs.readSync(fd, b, 0, 64, 0);
      const rate = b.readUInt32LE(24), byteRate = b.readUInt32LE(28);
      if (byteRate) out.duration = Math.round((size - 44) / byteRate) + ' s';
      if (rate) out.audio = rate + 'Hz';
    }
  } catch (_) {} finally { fs.closeSync(fd); }
  return out;
}

/* ── Main entry: file → { kind, text, meta } ───────────────────── */
function read(file) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const base = { file, bytes: stat.size, ext };

  // Plain text / code / structured
  if (/\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|java|c|cpp|h|rs|php|sh|sql|log|ini|toml|env)$/i.test(ext)) {
    return { kind: 'text', text: fs.readFileSync(file, 'utf8'), meta: base };
  }

  // Office (ZIP-based)
  if (ext === '.docx') {
    const z = readZipEntries(fs.readFileSync(file));
    const doc = z['word/document.xml'];
    return { kind: 'docx', text: doc ? xmlText(doc) : '', meta: base };
  }
  if (ext === '.pptx') {
    const z = readZipEntries(fs.readFileSync(file));
    const slides = Object.keys(z).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort();
    const text = slides.map((k, i) => `## Slide ${i + 1}\n` + xmlText(z[k])).join('\n\n');
    return { kind: 'pptx', text, meta: { ...base, slides: slides.length } };
  }
  if (ext === '.xlsx') {
    const z = readZipEntries(fs.readFileSync(file));
    const shared = [];
    if (z['xl/sharedStrings.xml']) {
      const sx = z['xl/sharedStrings.xml'].toString('utf8');
      (sx.match(/<si>[\s\S]*?<\/si>/g) || []).forEach(si => shared.push(xmlText(si)));
    }
    const sheets = Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
    let text = '';
    sheets.forEach((k, si) => {
      text += `## Sheet ${si + 1}\n`;
      const sh = z[k].toString('utf8');
      (sh.match(/<row[\s\S]*?<\/row>/g) || []).slice(0, 200).forEach(row => {
        const cells = [];
        (row.match(/<c[^>]*>[\s\S]*?<\/c>|<c[^>]*\/>/g) || []).forEach(c => {
          const t = /t="s"/.test(c);
          const v = (c.match(/<v>(.*?)<\/v>/) || [])[1];
          if (v == null) { cells.push(''); return; }
          cells.push(t ? (shared[+v] || v) : v);
        });
        if (cells.some(x => x !== '')) text += cells.join(' | ') + '\n';
      });
      text += '\n';
    });
    return { kind: 'xlsx', text, meta: { ...base, sheets: sheets.length } };
  }

  // PDF — pdftotext (poppler) if present; else rough in-stream text
  if (ext === '.pdf') {
    if (have('pdftotext')) {
      const out = tryRun('pdftotext', ['-q', '-enc', 'UTF-8', file, '-']);
      if (out != null) return { kind: 'pdf', text: out, meta: { ...base, engine: 'pdftotext' } };
    }
    const raw = fs.readFileSync(file, 'latin1');
    const chunks = [...raw.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map(m => m[1].replace(/\\([()\\])/g, '$1'));
    return { kind: 'pdf', text: chunks.join(' '), meta: { ...base, engine: 'raw', note: 'install poppler (pdftotext) for better results' } };
  }

  // Media — ffprobe if present, else pure-JS header parsing
  if (/\.(mp4|mov|mkv|avi|webm|mp3|wav|m4a|flac|ogg|aac)$/i.test(ext)) {
    let meta = { ...base, media: true };
    if (have('ffprobe')) {
      const j = tryRun('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file]);
      if (j) { try {
        const p = JSON.parse(j);
        const fmt = p.format || {};
        const v = (p.streams || []).find(s => s.codec_type === 'video');
        const a = (p.streams || []).find(s => s.codec_type === 'audio');
        meta.duration = fmt.duration ? Math.round(fmt.duration) + ' s' : undefined;
        meta.bitrate = fmt.bit_rate ? Math.round(fmt.bit_rate / 1000) + ' kbps' : undefined;
        if (v) meta.video = `${v.codec_name} ${v.width}x${v.height}`;
        if (a) meta.audio = `${a.codec_name} ${a.channels}ch ${a.sample_rate}Hz`;
        meta.engine = 'ffprobe';
      } catch (_) {} }
    }
    if (!meta.duration) { Object.assign(meta, pureMediaMeta(file, ext)); meta.engine = meta.engine || 'pure-js'; }
    const text = Object.entries(meta).filter(([k, v]) => v && !['file','bytes','ext','media'].includes(k))
      .map(([k, v]) => `- **${k}:** ${v}`).join('\n')
      + '\n\n> For a transcript: `athena transcribe ' + path.basename(file) + '` (whisper engine).';
    return { kind: 'media', text, meta };
  }

  // Image — dimensions + optional OCR (tesseract)
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(ext)) {
    let meta = { ...base, image: true };
    let ocr = '';
    if (have('tesseract')) {
      const out = tryRun('tesseract', [file, 'stdout']);
      if (out && out.trim()) ocr = '\n\n## OCR text\n' + out.trim();
    }
    return { kind: 'image', text: `- **image:** ${path.basename(file)} (${stat.size} bytes)` + ocr, meta };
  }

  // Unknown binary — safe summary
  const head = fs.readFileSync(file).slice(0, 16).toString('hex');
  return { kind: 'binary', text: `Binary file · ${stat.size} bytes · signature ${head}`, meta: base };
}

module.exports = { read, readZipEntries, xmlText, have };
