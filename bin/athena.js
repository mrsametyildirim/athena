#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════
   Athena — one knowledge engine
   Memory (Obsidian-like) · Ingestion (NotebookLM-like) ·
   Browser control (Playwright/CDP) · Security audit
══════════════════════════════════════════════════════════════ */

const U = require('../src/util');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out.flags[key] = true;
      else { out.flags[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const HELP = `
${U.paint('cyan', U.paint('bold', '  ✦ ATHENA'))} ${U.dim('— a memory-keeping, knowledge-absorbing, self-growing engine')}

${U.paint('bold', '  MEMORY')} ${U.dim('(Obsidian-like, standalone markdown vault)')}
    athena remember "<title>" [--type ..] [--tag a,b] [--body ".."]   save knowledge
    athena recall  "<query>" [--tag x] [--limit N]                   search
    athena show    "<title>"                                          print a note
    athena list                                                       all notes
    athena forget  "<title>"                                          delete
    athena map [--mermaid]                                            knowledge graph

${U.paint('bold', '  INGESTION')} ${U.dim('(NotebookLM-like — every file type)')}
    athena ingest <file> [--title ".."] [--tag ..] [--ai]            docx·xlsx·pptx·pdf·csv·code·media·image → note
    athena transcribe <audio/video> [--model tiny|base|small] [--remember]  local whisper transcript

${U.paint('bold', '  PC CONTROL')}
    athena find "<pattern>" [--in root] [--content] [--ext pdf,docx]  find files (name/content)
    athena tabs                                                       list open browser tabs
    athena tabs --launch                                             open Chrome with the debug port
    athena tabs --goto <url> [--tab N] · --open <url> · --close N    navigate / open / close a tab
    athena tabs --eval "expr" [--tab N] · --text · --shot <file>     run a task / read text / screenshot

${U.paint('bold', '  BROWSER')} ${U.dim('(token-efficient Playwright verification)')}
    athena sweep [--dir .]                                           scan every page in one browser
    athena check <path..> [--get k=sel] [--eval k=expr]              JS/network errors + read selectors
    athena eval  <path> --js "expr"                                  run an expression in a page
    athena shot  <path> [--sel S] [--full] [--out f]                 animation-frozen screenshot
    athena login <account>                                           store a session

${U.paint('bold', '  SECURITY')}
    athena audit [dir]                                               static secret/vulnerability scan

${U.paint('bold', '  LEARN')} ${U.dim('(a lasting lesson from a session)')}
    athena learn "<lesson>" [--tag ..]                               save as a feedback note

  ${U.dim('Vault: ' + U.vaultDir())}
  ${U.dim('Repo: https://github.com/mrsametyildirim/athena  ·  a star helps it grow ⭐')}
  ${U.dim('(the `bilge` command is a built-in alias for `athena`.)')}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = (args._.shift() || '').toLowerCase();

  try {
    let code = 0;
    switch (cmd) {
      /* memory */
      case 'remember': code = require('../src/memory').remember(args); break;
      case 'recall':   code = require('../src/memory').recall(args);   break;
      case 'show':     code = require('../src/memory').show(args);     break;
      case 'forget':   code = require('../src/memory').forget(args);   break;
      case 'list':     code = require('../src/memory').list(args);     break;
      case 'map':      code = require('../src/graph').map(args);       break;
      case 'learn': { args.flags.type = 'feedback'; code = require('../src/memory').remember(args); break; }
      /* ingestion + media */
      case 'ingest':     code = await require('../src/ingest').ingest(args); break;
      case 'transcribe': code = await require('../src/media').transcribe(args); break;
      /* PC control */
      case 'find':     code = require('../src/find').find(args); break;
      case 'tabs':     code = await require('../src/tabs').tabs(args); break;
      /* browser (webprobe core, runs with its own argv) */
      case 'sweep': case 'check': case 'eval': case 'shot': case 'login': case 'run': case 'probe':
        code = await require('../src/browser').run(process.argv.slice(2)); break;
      /* security */
      case 'audit':    code = require('../src/audit').audit(args); break;
      /* help */
      case '': case 'help': case '--help': case '-h': console.log(HELP); code = 0; break;
      case 'version': case '--version': case '-v':
        console.log('athena ' + require('../package.json').version); code = 0; break;
      default:
        U.err('unknown command: ' + cmd);
        console.log(HELP); code = 1;
    }
    process.exit(code);
  } catch (e) {
    U.err(String(e && e.message || e).split('\n')[0]);
    process.exit(1);
  }
}

main();
