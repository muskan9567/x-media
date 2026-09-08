# Tweets explorer

Open `/posts` or choose **Tweets**. Collection, browsing, archive import, and export are free. The page uses [FxTwitter's public API](https://docs.fxembed.com/api/), with no API key, subscription, cookies, sign-in, or paid fallback.

## Find and save tweets

Enter a username, @handle, or X/Twitter profile link and choose **Find tweets**. Public tweets appear as each page is saved. Existing populated collections reopen from local storage without a network collection. Empty failed searches can retry. Every view, saved-account count, and export shows original standalone tweets only. Replies (including thread continuations), quote posts, and reposts are excluded from results. Original photos and videos remain eligible outside Short bangers. Existing underlying history is preserved. Account identity is checked against every saved page.

**Stop collection** preserves the checkpoint. **Continue older posts** resumes it. Each run pauses after 50 pages to limit load on the free source. Requests are spaced at least 1.2 seconds apart, and rate limits trigger a shared cooldown. **Refresh latest** checks up to five recent pages, updating available counts while retaining older saved records and the history checkpoint. Transient failures retry with backoff; source outages, unknown accounts, repeated pages, and storage failures remain visible.

Free public timelines can omit older posts or become unavailable. The app cannot guarantee every account or complete lifetime history. A returned empty timeline does not prove there are no historical posts. If the source also reports zero total posts, the page says so and suggests checking the handle. It never labels free timeline exhaustion as verified full history.

## Import older history for free

For your own account, [request an X archive](https://help.x.com/en/managing-your-account/how-to-download-your-x-archive), download it, and unzip it. Choose **Import archive**, then select `account.js` and `tweets.js` together from the archive's `data` folder. Include `tweets-part1.js` and other tweet part files if present. Up to 32 files totaling 25 MB can be selected per batch; include `account.js` with each batch. ZIP files themselves are not accepted.

The account file supplies the owner ID and handle so posts cannot be accidentally filed under whichever account is open. Other personal account fields are discarded in the browser. Files are parsed as data; uploaded JavaScript is never executed. Unrelated archive files, invalid rows, identity mismatches, and malformed dates are rejected before any import commits. Stop a running collection for the same account before importing.

Imports are atomic, deduplicate by tweet ID, and preserve existing fetched records and metrics. Reimporting a file is safe. Imports make no external requests, and rankings, filters, and text copying work locally. Available remote attachment URLs are retained; this does not import the archive's local media directory. Attachment playback still requires the remote media to exist. Archive engagement counts are snapshots, and missing views/reply counts remain unknown. An imported file is not treated as proof of complete history.

**Export JSON** downloads the saved profile and posts, excluding internal job checkpoints and credentials. The file can be imported again or moved to another X Media installation. It exports all saved original tweets for the account, independent of the current keyword, category, or date filter.

## Browse

| View | Behavior |
| --- | --- |
| Most popular | Sort saved tweets by likes, reposts, or views; unknown counts sort last. |
| Recent | Newest saved tweets first. |
| Oldest | Earliest saved tweets first; this is not necessarily the account's first tweet. |
| Short bangers | Standalone text with at least one like; excludes replies, quote posts, and detected media. Choose 80, 140, or 280 visible characters. |

Keyword, period, and minimum likes filters run on saved original tweets. There is no Include replies option. The app classifies post types; it cannot verify which homepages received a post. Thirty rows render initially; **Show 30 more** expands the list. Copy retains full text, Open visits X, and supported videos use the saved-attachment streaming route with byte ranges and retry controls.

## Storage and API

`.data/posts/state.json` stores profiles, posts, snapshots, imports, and collection checkpoints with atomic writes. Browser storage remembers only the selected handle. On upgrade, paid-source collections retain their posts but discard incompatible cursors and stale payment errors. Previously configured `X_POSTS_BEARER_TOKEN` and `.data/posts/connection.json` are unused by this page. No billable source is imported by the active Posts service.

- `GET /api/posts`: saved account summaries.
- `GET /api/posts?username=handle`: records and status with ETag polling.
- `POST /api/posts`: `{ "username": "handle", "action": "open" | "collect" | "continue" | "refresh" | "stop" }`.
- `POST /api/posts/import`: validated `{ "format": "x-media-posts", "version": 1, "profile": {...}, "posts": [...] }`. Same-origin JSON; bounded streaming body; atomic save.
- `GET /api/posts/export?username=handle`: portable JSON attachment.
- `GET /api/posts/connection`: `{ "configured": true, "source": "timeline", "free": true }`.
- `POST /api/posts/connection`: 410 with reload guidance for old clients; accepts no credentials.
- `GET /api/posts/video?username=handle&post=id&media=key`: streams a saved MP4 attachment.

The process lock owns a single app server. Back up `.data` while stopped. The separate dashboard retains its existing optional provider settings.

## Connection recovery

Use the X Media desktop shortcut or `scripts/run-x-media.ps1` to start the production build. Startup checks local tweet storage without waiting for Reddit's collector. The Tweets page retries initial connection failures with a bounded backoff, so opening the page before the server is ready recovers automatically. Search and polling requests time out after 20 seconds instead of remaining stuck. Polling outages retain displayed tweets; the Reconnect button also reloads immediately. An empty imported archive reopens locally without silently starting a collection.

## Verify

```sh
npx vitest run src/lib/posts src/app/api/posts
node scripts/test-posts-free-browser.mjs
```

Unit tests use isolated temporary stores and cover native archive parsing, multipart imports, Unicode length, duplicate imports, local persistence, identity collisions, streamed upload limits, free migration, timeline pagination, retries, and stop/resume. Legacy full-archive tests cover retained unused code; they do not establish live paid access. Browser checks distinguish actual public collection from mocked upload UI fixtures, and never add synthetic tweets to the user's saved data.
