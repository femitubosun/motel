# motel

A local OpenTelemetry ingest + TUI viewer for development, backed by SQLite.
Point your app's OTLP/HTTP exporters at the local motel server and browse
traces, spans, and logs from a terminal or the built-in web UI.

## Requirements

- [Bun](https://bun.sh/) — v1.1 or newer

## Quick start

```bash
bun install
bun run dev
```

`bun run dev` starts the local OTLP ingest server (on `http://127.0.0.1:27686`)
and launches the TUI. Press `?` once inside for the keyboard cheat sheet, or
`c` to copy paste-ready setup instructions for another Effect/OTEL app.

If you just want the server without the TUI (for example, to run it in the
background and browse the web UI):

```bash
bun run server
# then in another terminal
bun run web:dev
```

## Commands

- `bun install`
- `bun run server`
- `bun run dev`
- `bun run test`
- `bun run cli services`
- `bun run cli traces <service>`
- `bun run cli span <span-id>`
- `bun run cli search-traces <service> [operation]`
- `bun run cli trace-stats <groupBy> <agg> [service]`
- `bun run cli logs <service>`
- `bun run cli search-logs <service> [body]`
- `bun run cli log-stats <groupBy> [service]`
- `bun run cli trace-logs <trace-id>`
- `bun run cli facets <traces|logs> <field>`
- `bun run instructions`
- `bun run typecheck`

## Local ports

This repo uses one local Bun server with SQLite storage. No Docker is required.

- motel local API / UI base: `http://127.0.0.1:27686`
- OTLP HTTP traces: `http://127.0.0.1:27686/v1/traces`
- OTLP HTTP logs: `http://127.0.0.1:27686/v1/logs`
- health: `http://127.0.0.1:27686/api/health`

Other local apps can send telemetry to:

```bash
http://127.0.0.1:27686/v1/traces
http://127.0.0.1:27686/v1/logs
```

Agents and scripts can query traces and logs from the local API:

```bash
http://127.0.0.1:27686/api/services
http://127.0.0.1:27686/api/traces?service=<service>&limit=20&lookback=1h
http://127.0.0.1:27686/api/traces/search?service=<service>&operation=proxy&status=error&attr.sessionID=<session-id>
http://127.0.0.1:27686/api/traces/stats?groupBy=operation&agg=p95_duration&service=<service>
http://127.0.0.1:27686/api/spans/<span-id>
http://127.0.0.1:27686/api/spans/<span-id>/logs
http://127.0.0.1:27686/api/spans/search?service=<service>&operation=Format.file&parentOperation=Tool.write&attr.sessionID=<session-id>
http://127.0.0.1:27686/api/traces/<trace-id>/spans
http://127.0.0.1:27686/api/logs?service=<service>&body=proxy_request
http://127.0.0.1:27686/api/logs?service=<service>&attr.service.name=<service>
http://127.0.0.1:27686/api/logs/stats?groupBy=severity&agg=count&service=<service>
http://127.0.0.1:27686/api/facets?type=logs&field=severity
http://127.0.0.1:27686/openapi.json
http://127.0.0.1:27686/docs
```

## TUI keys

- `?`: show or hide keyboard shortcut help
- `j` / `k` or `up` / `down`: move selection
- `ctrl-n` / `ctrl-p`: switch traces even while in trace details
- `gg` or `home`: jump to the first trace or first span
- `G` or `end`: jump to the last trace or last span
- `ctrl-u` / `pageup`: move up by one page
- `ctrl-d` / `pagedown`: move down by one page
- `l`: toggle service logs mode
- `[` / `]`: switch service
- `enter`: enter span navigation or open selected span detail
- `esc`: leave span detail or span navigation
- `r`: refresh
- `c`: copy a paste-ready Effect setup prompt for another app
- `o`: open selected trace in browser
- `q`: quit

## How It Works

`motel` now has one local service process:

- the local Bun server receives OTLP traces and logs on `http://127.0.0.1:27686`
- it stores telemetry in SQLite at `.motel-data/telemetry.sqlite`
- it exposes query endpoints on the same base URL

So yes: another service has to point its OTEL exporters at this local motel instance.

## Privacy Note

`motel` is a local observability tool, and it can store sensitive telemetry content if the upstream app emits it.

- correlated logs may include secrets, tokens, or PII if your app logs them
- AI call data may include prompt previews, response previews, full prompt content, response text, tool metadata, and provider metadata
- treat the local SQLite store as sensitive development data when using motel against real workloads

The easiest flow is:

1. Run `bun run dev` here. That starts the local server if needed and then launches the TUI.
2. In `motel`, press `c`.
3. Paste the copied instructions into an agent working in the other service.
4. Have that service export OTEL traces to `http://127.0.0.1:27686/v1/traces` and OTEL logs to `http://127.0.0.1:27686/v1/logs`.
5. Refresh `motel`, switch to that service with `[` / `]`, and use `l` or `enter` to inspect logs under a trace or span.

## For Agents

An agent does not need to talk to the TUI.

List and search endpoints now return a `meta` object with `limit`, `lookback`, `returned`, `truncated`, and `nextCursor` so callers can page safely instead of assuming they received all results.

Use one of these:

1. motel HTTP API directly

```bash
curl http://127.0.0.1:27686/api/services
curl "http://127.0.0.1:27686/api/traces?service=my-service&limit=20&lookback=1h"
curl http://127.0.0.1:27686/api/traces/<trace-id>
```

2. The local CLI wrapper in this repo

```bash
bun run cli services
bun run cli traces my-service 20
bun run cli span <span-id>
bun run cli trace-spans <trace-id>
bun run cli search-spans my-service Format.file parent=Tool.write attr.sessionID=sess_123
bun run cli search-traces my-service proxy attr.sessionID=sess_123
bun run cli trace-stats operation p95_duration my-service attr.modelID=gpt-5.4
bun run cli trace <trace-id>
bun run cli logs my-service
bun run cli search-logs my-service timeout attr.tool=search
bun run cli log-stats severity my-service attr.tool=search
bun run cli trace-logs <trace-id>
bun run cli span-logs <span-id>
bun run cli facets logs severity
bun run instructions
```

Recommended shape going forward:

1. Keep motel as the single ingest point for apps.
2. Keep SQLite as the local source of truth.
3. Keep `motel` as the interactive viewer.
4. Keep the CLI and HTTP API as the agent/script interfaces.
