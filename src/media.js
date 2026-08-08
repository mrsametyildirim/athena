'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — Media Transcription (ffmpeg + whisper, no external CLI)

   Turns audio/video into text. Both engines ship via npm; you do
   NOT need ffmpeg/whisper installed on your system:
     • ffmpeg-static      → downsamples audio to 16kHz mono WAV
     • @xenova/transformers → local transcription with whisper (ONNX)

   Install (once): npm i -g ffmpeg-static @xenova/transformers
   (or Athena's optionalDependencies fetch them automatically.)

   On first run the whisper model (~40-150MB) is downloaded and
   cached; afterwards it is offline and fast.
══════════════════════════════════════════════════════════════ */

const U = require('./util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function ffmpegPath() {
  try { return require('ffmpeg-static'); } catch (_) { return null; }
}

/* Convert the audio stream to the 16kHz mono float WAV whisper expects. */
function extractWav(file) {
  const ff = ffmpegPath();
  const wav = path.join(os.tmpdir(), 'athena-' + Date.now() + '.wav');
  if (ff) {
    const r = spawnSync(ff, ['-y', '-i', file, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], { stdio: 'ignore' });
    if (r.status === 0 && fs.existsSync(wav)) return wav;
  }
  // try system ffmpeg if present
  const sys = spawnSync('ffmpeg', ['-y', '-i', file, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], { stdio: 'ignore' });
  if (sys.status === 0 && fs.existsSync(wav)) return wav;
  return null;
}

/* WAV (16-bit PCM) → Float32 sample array */
function wavToFloat32(wav) {
  const buf = fs.readFileSync(wav);
  // find the data chunk
  let p = 12;
  while (p < buf.length - 8) {
    const id = buf.toString('ascii', p, p + 4);
    const sz = buf.readUInt32LE(p + 4);
    if (id === 'data') {
      const n = Math.floor(sz / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(p + 8 + i * 2) / 32768;
      return out;
    }
    p += 8 + sz + (sz & 1);
  }
  return new Float32Array(0);
}

async function transcribe(args) {
  const src = args._[0];
  if (!src) { U.err('usage: athena transcribe <audio/video> [--model tiny|base|small] [--remember]'); return 1; }
  if (!fs.existsSync(src)) { U.err('file not found: ' + src); return 1; }

  let transformers;
  try { transformers = await import('@xenova/transformers'); }
  catch (_) {
    U.err('whisper engine missing. Install: ' + U.dim('npm i -g @xenova/transformers ffmpeg-static'));
    U.info('Once installed, `athena transcribe` runs fully local and offline.');
    return 1;
  }

  U.info('extracting audio…');
  const wav = extractWav(src);
  if (!wav) { U.err('audio extraction failed — is ffmpeg-static installed? ' + U.dim('npm i -g ffmpeg-static')); return 1; }
  const audio = wavToFloat32(wav);
  try { fs.unlinkSync(wav); } catch (_) {}
  if (!audio.length) { U.err('could not parse WAV'); return 1; }

  const size = (args.flags.model && args.flags.model !== true) ? args.flags.model : 'base';
  U.info(`whisper (${size}) loading — model may download on first use…`);
  const pipe = await transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-' + size);
  const res = await pipe(audio, { chunk_length_s: 30, stride_length_s: 5 });
  const text = (res && res.text || '').trim();

  console.log('\n' + text + '\n');
  if (args.flags.remember) {
    const mem = require('./memory');
    mem.remember({ _: ['transcript ' + path.basename(src)], flags: {
      type: 'reference', tag: 'transcript,media',
      body: '# Transcript: ' + path.basename(src) + '\n\n' + text } });
  }
  U.ok('transcript ready (' + text.length + ' chars)');
  return 0;
}

module.exports = { transcribe, ffmpegPath };
