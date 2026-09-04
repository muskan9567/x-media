# Architecture and HTTP API

X Media runs as a Next.js App Router application with a persistent Node.js server. React renders the archive at `/`; `/archive` redirects there. The optional tracker is at `/dashboard`.

## Archive data flow

```text
Username form → local jobs API → serialized persistent queue
                                      ↓
                             public media worker → FxTwitter
                                      ↓
                         atomic writes to .data/archive-jobs
                                      ↓
                         server-sent events → media browser

Saved video → local range-streaming proxy → approved X media CDN
```

The queue starts one worker at a time. New searches use the FxTwitter v2 public media timeline. Empty timelines resolve the profile separately. Returned attachments must match the requested author and approved media hosts. State includes account results, jobs, source identity, seen post IDs, and page cursors. A process lock prevents competing queue owners.

Workers save each page, yield after three pages, and continue at the persisted cursor. Each job is bounded to 10,000 scanned posts and workers have a 90-second deadline. A genuine rate limit imposes a shared cooldown; other transient errors affect only that job. Restart recovery preserves completed batches. A failed or smaller refresh cannot erase the larger saved library.

The browser opens saved collections from its bounded cache and revalidates locally. Event streams publish persisted changes; disconnect cleanup and backpressure handling prevent abandoned clients from holding streams indefinitely. Polling provides a fallback.

Video requests identify an existing saved attachment rather than accepting arbitrary source URLs. The proxy validates approved hosts and supports byte ranges for seeking. Link repair uses public syndication first, then FxTwitter's post endpoint. No main-archive operation requires login credentials.

## Source map

| Module | Responsibility |
| --- | --- |
| `src/components/tracker/media-archive-explorer.tsx` | Search form, status, gallery, filters, sorting, and inspection |
| `src/components/tracker/use-archive-jobs.ts` | Saved collection cache, requests, event streams, and fallback polling |
| `src/lib/tracker/archive-jobs.ts` | Public entry point for the persistent queue |
| `src/lib/tracker/archive-*.ts` | Queue state, persistence, scheduling, events, and media handling |
| `scripts/free-media-worker.mjs` | Worker entry point and source selection |
| `scripts/fx-media-worker.mjs` | Anonymous FxTwitter timeline collection |
| `scripts/stream-media-worker.mjs` | Legacy scraper worker for older jobs/integrations |
| `src/lib/tracker/media-archive.ts` | Archive types and the legacy official-provider implementation |
| `src/lib/tracker/free-media-archive.ts` | Legacy free archive normalization |
| `src/lib/tracker/service.ts` | Optional tracker operations and aggregation |
| `src/lib/tracker/store.ts` | Tracker JSON persistence |

## Archive API

Requests and responses are JSON unless noted. These are local application endpoints with no user authentication; keep the server bound to loopback.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/media-archive/jobs` | Saved-account summaries and recent jobs |
| `POST` | `/api/media-archive/jobs` | `{ username, refresh?: boolean }`; opens saved results or queues collection |
| `GET` | `/api/media-archive/jobs/:id` | Persisted progress and merged media |
| `GET` | `/api/media-archive/jobs/:id/events` | Server-sent events for persisted progress |
| `POST` | `/api/media-archive/jobs/:id` | `{ action: "cancel" }`, `{ action: "retry" }`, or `{ action: "repair", postId }` |
| `GET` | `/api/media-archive/jobs/:id/video?item=attachment-id` | Stream a saved MP4, including range requests |
| `POST` | `/api/media-archive` | Legacy synchronous collection; separate configured provider selection |

Job creation returns HTTP 202 with a view containing `job`, `result`, `source`, and optional `collectedAt`. A saved lookup does not create another job or write the archive file. Retry returns an active/new job view, so clients should use the returned job ID. An accepted request is not evidence that upstream collection has succeeded.

## Optional tracker API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/tracker` | Dashboard snapshot |
| `POST` | `/api/accounts` | Add and initially sync an account |
| `PATCH` | `/api/accounts/:id` | Pause/resume or update manual niches |
| `DELETE` | `/api/accounts/:id` | Remove an account and its retained posts |
| `POST` | `/api/sync` | Sync active accounts or a validated ID selection |
| `PATCH` | `/api/tweets/:id` | Update local review status |
| `GET` | `/api/cron/sync` | Scheduled sync protected by `CRON_SECRET` |
| `GET` | `/api/health` | Provider mode and server timestamp |

## Running and persistence

Use one persistent Node process per data directory. Ephemeral serverless functions and static hosting do not support this queue's filesystem persistence. Back up `.data` while the server is stopped. Historical `.data/media-archive-cache` records are imported on first archive startup without rewriting the originals. Legacy in-progress jobs keep their original source identity until finished.

The tracker and archive use separate stores and provider selection. Dashboard retention settings do not expire archive collections. See [dashboard configuration](DASHBOARD.md) for those settings.
