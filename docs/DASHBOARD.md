# Optional dashboard and configuration

Open `/dashboard` for a watchlist, media library, viral feed, and manual reply review queue. These features are separate from the anonymous archive at `/`.

## Demo and live modes

Without `X_BEARER_TOKEN`, the dashboard uses deterministic demo accounts and metric changes. The archive never substitutes demo results.

To configure optional dashboard settings, copy `.env.example` to `.env.local` (`Copy-Item .env.example .env.local` in PowerShell, or `cp .env.example .env.local` in a POSIX shell), edit it, and restart the server.

A server-only `X_BEARER_TOKEN` selects the official X API v2 provider. It resolves usernames, follows immutable user IDs across handle changes, and requests up to 100 recent original posts per account. API permissions, availability, and billing depend on the token's X project. This recent timeline is not a complete lifetime archive.

New live-mode data starts empty. Existing demo records retain their provenance and cannot become authentic X posts merely because a token is added. Remove and re-add an account to collect live data. Tokens must never use a `NEXT_PUBLIC_` prefix.

## Settings

| Variable | Default | Scope and constraints |
| --- | --- | --- |
| `X_BEARER_TOKEN` | blank | Dashboard official provider and legacy synchronous archive endpoint |
| `X_API_BASE_URL` | `https://api.x.com/2` | Official-compatible API base; HTTPS except loopback development; rejects embedded credentials, queries, and fragments |
| `TRACKER_DATA_FILE` | `.data/tracker-state.json` | Dashboard JSON file, relative to the project root unless absolute |
| `MAX_TRACKED_ACCOUNTS` | `25` | Dashboard watchlist limit; integer 1–1000 |
| `DATA_RETENTION_DAYS` | `30` | Dashboard retained-post window; integer 1–3650 |
| `CRON_SECRET` | blank | Bearer secret for `GET /api/cron/sync` |
| `X_SCRAPER_AUTH_TOKEN` | blank | Legacy synchronous endpoint only; optional server cookie paired with `X_SCRAPER_CT0` |
| `X_SCRAPER_CT0` | blank | Legacy synchronous endpoint only; paired cookie |
| `X_SCRAPER_MAX_POSTS` | `10000` | Legacy synchronous endpoint only; integer 1–50000 |
| `X_SCRAPER_TIMEOUT_MS` | `90000` | Legacy synchronous endpoint only; integer 1–300000 milliseconds |

Blank numeric settings use defaults; invalid nonblank settings fail validation. The main anonymous archive ignores all three credential settings and uses fixed collection limits. Its state stays under `.data/archive-jobs` regardless of `TRACKER_DATA_FILE`.

The legacy `POST /api/media-archive` endpoint retains earlier integrations: a bearer token selects official full-archive search, paired cookies select the authenticated scraper, and absent credentials select its free provider. Official full-archive access requires the corresponding X project permissions. These choices do not change the main archive's job-based anonymous collector.

## Watchlist and review

Add an account with **Track account**, then use **Sync now**. Pause or remove accounts, override inferred niches, inspect returned media attachments, and save/dismiss/mark review opportunities as responded. Replies remain manual. Reply shortcuts are disabled for demo posts and unavailable when reply eligibility is restricted or unknown.

## Scoring

Weighted engagement combines likes, reposts, quotes, replies, and bookmarks:

```text
likes + 2.2 × reposts + 1.8 × quotes + 0.7 × replies + 1.25 × bookmarks
```

Virality combines comparable-age engagement velocity, robust median/MAD deviation from an author's own history, audience-relative performance, momentum, reach, freshness, and confidence. Scores are clamped to 0–100. Low-history accounts are pulled toward the midpoint, and unchanged later observations clear stale positive momentum.

Reply opportunity combines virality, niche fit, freshness, conversation openness, and confidence, with penalties for saturation, restricted/unknown eligibility, and content risks. These are ranking heuristics, not statistical guarantees. The interface exposes reasons so the operator can decide what merits attention.
