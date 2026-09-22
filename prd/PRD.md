# PRD — who/otel-judge-demo

**Status:** Draft for beads decomposition (source of truth for build)  
**Repo:** `who/otel-judge-demo` (GitHub Pages)  
**Depends on:** Deployed Worker from `who/otel-judge` (`VITE_API_BASE`); producer API from `who/otel-judge-firehose`  
**Not submitted** as the Cloudflare application GitHub URL  
**Historical decisions log:** `who/otel-judge` → `docs/DESIGN.md`

---

## Problem

Reviewers need a **light-mode, product-quality live board** that makes packet flow and Jev→Llama evaluate obvious in seconds. That UI must not live in the submit Agent repo.

## Goals

1. Host polished demo at `https://who.github.io/otel-judge-demo/` (or equivalent).  
2. Connect with `useAgent({ host: Worker })` for live board state from the Agent.  
3. Emit controls call **`otel-judge-firehose`** (fixtures/chaos) — never ask the Agent to invent packets.  
4. Inspector shows compact summary, Jev probability bars, Llama verdict.  

## Non-goals

- Agent / Workflow / Jev / Llama implementation  
- Secrets in the Pages bundle (`TYPESAFE_API_KEY`, etc.)  
- Factorio branding or HN-site chrome (orange/beige news UI)  
- Being the Cloudflare submit GitHub URL  

## Vocabulary

Same as submit PRD: **packet**, **producer**, **channel**. This repo is the **Pages channel client** only — generation lives in `otel-judge-firehose`.

## Ownership (normative)

### This repo owns

- Vite/static app + GitHub Pages deploy workflow  
- Board UI: stages, packet chips, inspector  
- `useAgent` client wiring (`VITE_API_BASE` / Worker host only — naming-things pattern)  
- Emit / scenario / pause controls that call the **firehose producer** HTTP API  

### This repo does not own

- Agent class, Wrangler secrets, Evaluate Workflow  
- Fixture/chaos generation (see `PRD-otel-judge-firehose`)  
- Sanitized Ortus `PROMPT_HISTORY` for the Agent (lives in `otel-judge`)  

## UX requirements (normative)

- Light-mode **product-demo** aesthetic (HN-postable quality, not HN look-alike)  
- Immediate grasp: where packets are, what Jev returned, what Llama judged  
- Click packet → inspector (summary, vector bars, verdict text/actions)  
- Emit does not call “Agent invent telemetry”

## Producer integration (normative)

Emit → `otel-judge-firehose` → Judge Worker ingress → Agent.  

This repo does **not** implement chaos LLM logic. It only passes scenario/rate params to the firehose service.

## Requirements

- FR1: With Worker up and CORS allowlisted, board shows live packet stages  
- FR2: Emit calls firehose producer; resulting packet appears and progresses to a verdict on the board  
- FR3: No secrets in `import.meta.env` beyond public Worker URL  
- FR4: Inspector renders Jev distributions + Llama verdict from Agent state/API  
- NFR1: Light-mode product demo aesthetic  
- NFR2: One-way dependency — demo → Worker; never required by Agent compile  

## Acceptance criteria

- [ ] Pages deploy from `main`  
- [ ] `otel-judge` README can link this URL  
- [ ] Demo works against production Worker origin  
- [ ] Local mode documented  
- [ ] Emit path documented as demo → `otel-judge-firehose` → Judge ingress, not Agent generation  

## Beads (epics)

1. Scaffold Vite + Pages workflow  
2. Board + inspector against mock state  
3. Wire `useAgent` to real Worker  
4. Emit → wire to `otel-judge-firehose` API  
5. Polish + README  

## Open questions

- Firehose producer public URL / env name for Pages (`VITE_FIREHOSE_BASE` vs same origin proxy)  
