# otel-judge-demo

A light-mode live board that shows OpenTelemetry packets moving through the
otel-judge pipeline: ingest, Jev scoring, Llama evaluation, verdict. It is the
public, linkable face of the judge, not the judge itself, and it is not the
Cloudflare submission repository.

**Live URL:** https://who.github.io/otel-judge-demo/

The board connects to the Judge Worker's Agent for state, and its emit,
scenario and pause controls talk to the separate `otel-judge-firehose`
producer. Everything this app knows about a packet arrives from those two
origins.

## Quick start

```bash
npm install
npm run dev       # Vite dev server on http://localhost:5173/otel-judge-demo/
npm run build     # static bundle in dist/
npm run preview   # serve the built bundle locally
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

A fresh clone needs no configuration. With no environment variables set the
board runs in mock mode against a deterministic fixture, so `npm run dev` is
enough to see the UI working end to end.

## Environment variables

Both values are public origins. Neither is a secret.

| Name | Public? | Purpose | When unset |
| --- | --- | --- | --- |
| `VITE_API_BASE` | Yes | Origin of the Judge Worker (Cloudflare Agents SDK). The board subscribes to the `judge-agent` Agent, instance `board`, at this host. | The board runs in mock mode. |
| `VITE_FIREHOSE_BASE` | Yes | Origin of the `otel-judge-firehose` producer. The emit, scenario and pause controls POST to `/emit`, `/scenario` and `/pause` under this origin. | The controls report that the producer is not configured and issue no requests. |

Both names are read by `readEnv()` in `src/lib/env.ts` and injected at build
time by `.github/workflows/deploy.yml`. Keep the three in step: a documented
name that drifts from the code is worse than no documentation.

Copy `.env.example` to `.env.local` to set them for local development. Values
are trimmed, must be `http:` or `https:` URLs, and lose any trailing slash. A
malformed value is treated as unset.

**No secrets, ever.** The `VITE_` prefix means Vite compiles the value into a
bundle that any visitor can read from the network tab. No credential of any
kind may be added to a `VITE_` variable, and specifically not
`TYPESAFE_API_KEY`, which belongs to the Judge Worker's Wrangler secrets. The
env module refuses to start if any exposed key contains `KEY`, `TOKEN` or
`SECRET`, and the deploy workflow reads only repository variables, never the
secrets context, so an accident fails loudly instead of leaking.

## Local and mock mode

Mock mode is the default. When `VITE_API_BASE` is unset the board loads a
hardcoded fixture with at least one packet in every stage and advances each
packet one column every two seconds. The header badge reads **Mock** with the
detail "No Worker configured; running on the local fixture". Nothing in mock
mode touches the network.

The badge has four states, and they are deliberately distinct:

| Badge | Meaning |
| --- | --- |
| Mock | No Worker configured. Offline demo on the fixture. |
| Connecting | A Worker is configured and the socket is opening or reconnecting. |
| Live | Streaming from the Worker. The detail shows the Worker hostname. |
| Degraded | The connection failed or the last payload was unusable. The board keeps the last good state. |

A Degraded badge on a deployed page almost always means the Pages origin is
not CORS-allowlisted on the Worker. See the human prerequisites below before
concluding the demo is broken.

To run against a real Worker locally, set `VITE_API_BASE` in `.env.local` and
restart the dev server. Vite reads env files at startup only.

## Emit path

Emit goes demo to `otel-judge-firehose` to Judge Worker ingress to Agent.

The emit, scenario and pause controls in the header call the firehose
producer's HTTP API and nothing else. The producer generates the packets,
sends them into the Judge Worker's ingress, and the Worker's Agent pushes the
resulting board state back to this page over the Agent connection. The demo
never asks the Agent to invent telemetry, and no packet is ever generated in
this repository: the client in `src/lib/firehose.ts` only forwards a scenario
name, a count or a rate, and a paused flag.

Requests to the producer are unauthenticated and sent with credentials
omitted, time out after eight seconds, and never throw. A rejected or failed
request surfaces as a message in the controls rather than an unhandled error.

The firehose is reached through its own public `VITE_FIREHOSE_BASE` variable
rather than a same-origin proxy. GitHub Pages serves static files only, so
there is no server to proxy through. This closes the open question in the PRD
and should not be reopened.

## Deployment

`.github/workflows/deploy.yml` builds the bundle and publishes it to GitHub
Pages on every push to `main`, and can also be run by hand from the Actions
tab. The build reads `VITE_API_BASE` and `VITE_FIREHOSE_BASE` from repository
variables. When they are unset the build still succeeds and the published page
runs in mock mode, so the URL stays live even before the Worker exists.

The site is a project site, so `vite.config.ts` sets the base path to
`/otel-judge-demo/`. The workflow must not override it. If the repository is
renamed or moved, the base path and the live URL above change together.

Overlapping pushes queue rather than interleave, so two deploys cannot race.

## Human prerequisites

These steps cannot be done from this repository and each one makes an
otherwise correct deploy look broken when it is missing.

1. **Enable Pages with the Actions source.** In the repository settings, under
   Pages, set Source to "GitHub Actions". Until this is done the deploy job
   fails at the deploy step.
2. **Set the two repository variables.** Under Settings, Secrets and
   variables, Actions, add `VITE_API_BASE` and `VITE_FIREHOSE_BASE` as
   repository *variables*, not secrets. The workflow reads the `vars` context
   only.
3. **CORS-allowlist the Pages origin on the Worker.** The Judge Worker must
   accept `https://who.github.io` for the Agent WebSocket handshake. Without
   it the badge shows Degraded.
4. **CORS-allowlist the Pages origin on the producer.** The
   `otel-judge-firehose` service must accept POSTs from `https://who.github.io`
   with a JSON content type. Without it every emit fails with a network error.

## What this repository owns

- The Vite static app and the GitHub Pages deploy workflow.
- The board UI: stage columns, packet chips, the inspector with Jev
  probability bars and the Llama verdict.
- The Agent client wiring through `useAgent`, configured by `VITE_API_BASE`.
- The emit, scenario and pause controls that call the firehose producer.

## What this repository does not own

- The Agent class, the Evaluate Workflow, Jev, Llama, and every Wrangler
  secret. These live in `otel-judge`.
- Fixture and chaos packet generation. This lives in `otel-judge-firehose`.
  Do not add a generator here.
- The design decisions log, which is `docs/DESIGN.md` in `otel-judge`.
- The Cloudflare submission. This repository is a demo, not the submitted
  Agent, and the Agent never depends on it at compile time.
