<div align="center">

# ✦ Athena

### A memory-keeping, knowledge-absorbing, self-growing engine
**Obsidian + NotebookLM + Playwright — in one token-thrifty CLI, with zero external tools.**

<br>

[![npm](https://img.shields.io/npm/v/@mrsametyildirim/athena?color=CB3837&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/@mrsametyildirim/athena)
[![node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![deps](https://img.shields.io/badge/runtime%20deps-0%20required-brightgreen)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](#-contributing)
[![made for Claude Code](https://img.shields.io/badge/made%20for-Claude%20Code-8A2BE2)](https://claude.com/claude-code)

<samp>An AI agent's memory, eyes, and shield — all in one place.</samp>

</div>

---

## 🧠 What is Athena?

**Athena** is a *knowledge engine* that runs alongside an AI coding agent (built for Claude Code).
It fuses the best of three powerful tools into one standalone CLI — depending on none of them,
calling no cloud service, and **burning almost no tokens**:

| Need | Classic tool | Athena's answer |
|---|---|---|
| 🗂️ Persistent memory & knowledge graph | Obsidian (GUI, locked vault) | `athena remember / recall / map` — plain markdown, git-friendly, portable |
| 📥 Turn documents into knowledge | NotebookLM (cloud, closed) | `athena ingest` — reads **every** file type offline, optional Claude summary |
| 🌐 Browser verification | Playwright MCP (pays for your code twice) | `athena sweep / check / shot` — **one browser, one call, short output** |
| 🖥️ Drive your PC | scattered scripts | `athena find` (files) · `athena tabs` (live browser control) |
| 🛡️ Security-hole hunting | separate SAST tools | `athena audit` — secret leaks + injection surfaces |

> **Why token-thrifty?** Playwright MCP echoes the code you send back as output — the same code
> costs tokens twice. Athena returns **only the result** and walks every page in **one browser**.
> It scans a 100-page site in ~30 seconds with a single line of output.

---

## ⚡ Install

```bash
npm install -g @mrsametyildirim/athena
# For browser control (optional):
npm i -g playwright-core && npx playwright install chromium
# For media transcription (optional, no system ffmpeg/whisper needed):
npm i -g ffmpeg-static @xenova/transformers
```

Try it right away:

```bash
athena help
athena remember "my first note" --tag test --body "Athena works 🎉"
athena map
```

> The `bilge` command is a built-in alias for `athena`.

---

## 🚀 60-second tour

```bash
# ── MEMORY — save, search, map knowledge ───────────────────────
athena remember "rolling-window quota" --type project --tag backend \
  --body "Quota resets per-user, 24h/30d after first use. Related → [[usage-periods]]"
athena recall "quota"
athena map                     # central notes · missing links · orphans
athena map --mermaid           # export the graph as a mermaid diagram

# ── INGEST — absorb ANY file into memory ───────────────────────
athena ingest report.docx      # Word, Excel, PowerPoint, PDF, CSV, code…
athena ingest data.xlsx --tag finance
athena ingest talk.mp4         # media → duration/codec metadata (no ffprobe needed)
athena transcribe talk.mp4 --remember   # local whisper transcript → memory
athena ingest NOTES.md --ai    # add a Claude summary if ANTHROPIC_API_KEY is set

# ── PC CONTROL — files & live browser ──────────────────────────
athena find "*.pdf" --in ~/Documents          # find by name
athena find "TODO" --content --ext js,ts      # find by content
athena tabs                                    # list open browser tabs
athena tabs --goto https://example.com --tab 0 # navigate a live tab
athena tabs --eval "document.title"            # run a task in a tab
athena tabs --text                             # read a tab's visible text

# ── BROWSER — verify without burning tokens ────────────────────
athena sweep                   # scan all .html pages in one browser
athena check index.html --get title=h1 --eval count="document.querySelectorAll('.card').length"
athena shot pages/app.html --sel ".hero" --out hero.png

# ── SECURITY — secret & vulnerability scan ─────────────────────
athena audit ./src            # service_role, private keys, SQL concat, innerHTML XSS…
```

---

## 📂 Reads every file — with no external tools

Athena unpacks Office files with Node's own `zlib` (no libraries) and falls back gracefully
when a system tool is missing:

| Format | How | Needs anything? |
|---|---|---|
| `.docx` `.pptx` `.xlsx` | pure-JS ZIP + XML | **no** |
| `.txt` `.md` `.csv` `.json` code/logs | direct | **no** |
| `.pdf` | `pdftotext` if present, else in-stream text | optional poppler |
| `.mp4` `.mp3` `.wav` … | pure-JS header parse (duration/codec); `ffprobe` if present | **no** for metadata |
| transcription | `ffmpeg-static` + `@xenova/transformers` (whisper, local) | optional, via npm |
| images | dimensions; `tesseract` OCR if present | optional |

Everything runs **offline**. Nothing is uploaded.

---

## 🌐 Live browser control (CDP)

`athena tabs` attaches to an **already-open** Chrome/Edge — it does not launch a throwaway
browser — and lets an agent read, navigate, and drive real tabs:

```bash
athena tabs --launch          # opens Chrome with the debug port, once
athena tabs                   # [0] GitHub  ·  https://github.com/…
athena tabs --goto <url>      # navigate
athena tabs --eval "expr"     # run a task in the page
athena tabs --shot page.png   # screenshot
```

---

## 🗺️ Knowledge map — Obsidian's heart, no GUI

Athena reads the `[[wiki-links]]` between notes and builds a **knowledge graph**:

```
• 12 notes · 34 links

  ◆ Most central notes (knowledge hubs)
    supabase-backend-techniques     ← 6 links
    security-rules                  ← 4 links

  ✎ Missing links (knowledge to write)
    rolling-window-quota            × 3 refs → no note yet   ← write this next!
```

**Missing links** surface knowledge you keep referencing but haven't written yet —
Athena maps your thinking and points at the gaps.

---

## 📦 Your vault — yours, portable, unlocked

Every note is a plain markdown file (`~/.athena/vault/` or `.athena/vault/` in a project):

```markdown
---
name: rolling-window-quota
description: Quota resets per-user, not at month start
type: project
tags: [backend, quota]
created: 2026-08-08T12:00:00Z
---

# Rolling-window quota
Renews 24h/30d after first use. Related → [[usage-periods]]
```

Locked to no application: version it with `git`, open it in any editor, move it to any machine.
The `MEMORY.md` index is rebuilt on every write.

---

## 🧩 Command summary

| Area | Commands | What |
|---|---|---|
| Memory | `remember` `recall` `show` `list` `forget` `map` | markdown knowledge + graph |
| Ingest | `ingest` `transcribe` | any file → structured note (+`--ai`, +whisper) |
| PC | `find` `tabs` | file search · live browser control |
| Browser | `sweep` `check` `eval` `shot` `login` | token-efficient verification |
| Security | `audit` | secret/vulnerability scan |
| Learn | `learn` | a lasting lesson from a session |

`athena help` always prints the full list.

---

## 🌱 Philosophy

- **Independence:** no cloud, no account, no closed format. Your data is yours.
- **Token thrift:** every command returns the shortest useful output; no noise.
- **Self-growth:** the more you use it, the deeper the memory layers, the richer the graph,
  the more visible the gaps. Athena is an engine that *learns*.
- **One file, one truth:** knowledge lives in markdown — readable, searchable, versioned.

---

## 🤝 Contributing

PRs, ideas, and rule suggestions (especially for `audit`) are very welcome.
A new language extractor, a graph visualizer, a vector-search plugin? Open an issue — let's talk.

<div align="center">

### ⭐ If Athena helps you, leave a star — the more it's used, the more it learns.

<sub>MIT licensed · built with care, counting every token.</sub>

</div>
