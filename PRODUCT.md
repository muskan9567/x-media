# X Media product boundaries

X Media is a personal local workspace for browsing public X (Twitter) media and tweets by username, collecting Reddit memes, and organizing media in named folders for later. The shared header has four destinations: X at `/`, Tweets at `/posts`, Reddit at `/reddit`, and Folders at `/folders`. The X archive remains the home page. A separate dashboard at `/dashboard` retains watchlist and manual review tools.

## Tweets explorer behavior

Search a username, @handle, or X profile link at `/posts` to collect available public tweets, showing only original standalone posts (including text and media). Save the account locally and switch immediately between Most popular (likes, reposts, or available views), Recent, Oldest collected, and Short bangers. Short bangers defaults to at most 140 visible characters with at least one like, ordered by likes, excluding replies, quotes, and media. Length, date range, keyword, and minimum likes controls keep the collection easy to inspect. Posts offer Copy text, Open on X, and inline media where available. Every category, saved-account count, and JSON export excludes replies and quote posts; reposts are excluded at ingestion. Existing raw history remains stored locally. Homepage placement is not inferred from views or likes.

The Tweets page uses FxTwitter's free public timeline. No login, cookies, developer account, API token, subscription, or prepaid credits are needed or used. Collection follows available cursors, pauses after 50 pages per run, and can resume; Refresh latest scans up to five pages. Public access and historical coverage depend on the source. Full lifetime history is never promised.

Import archive accepts data/account.js plus data/tweets.js and optional tweets-part files from an extracted X archive, or an X Media JSON export. Files are parsed as JSON data without executing JavaScript. The browser strips unrelated account data before sending normalized posts to this computer's server. Imports deduplicate, preserve existing records, validate identity, and commit atomically without external requests. Export JSON downloads the saved profile and posts. Native archive media URLs are preserved when supported; local media files are not copied. Imported counts are the archive snapshot, not live counts. Imports do not establish verified full-history coverage.

Profiles, posts, metrics, and job state persist in .data/posts/state.json with atomic writes. Existing paid-source records migrate to free collection without losing posts; incompatible cursors and stale payment errors are cleared. The legacy token file and environment value are unused by this page. The retired connection POST returns 410, and GET identifies a ready free timeline. See [Tweets explorer documentation](docs/POSTS.md).

## X archive behavior

- Accept public usernames without a login, cookies, API key, or paid provider.
- Preserve every supported attachment returned for the requested author's posts.
- Present videos first, with photo, GIF, all-media, and chronological controls.
- Save collections locally, reopen them quickly, and merge later discoveries.
- Show saved batches while a resumable, cancellable collection runs.
- Treat unavailable and incomplete upstream responses honestly; never substitute demo archive media.

## Reddit collection behavior

The integrated collector gathers image memes from focused AI and coding communities every three minutes while X Media is running. Collection works without a login or API key, and Find new memes can request a refresh. Preserve existing collections and decisions when remote sources fail or are rate-limited; expose collection health and errors honestly.

| View | Route | Behavior |
| --- | --- | --- |
| All memes | `/reddit` (also `/reddit/explore`) | Search titles, communities, tags, and analyzed image text; filter S/A/B ranks and communities; sort by quality, date, or votes; load more results. |
| For you | `/reddit/picks` | Stable recommendation batches informed by explicit feedback and seen history, with an explicit Next batch action. |
| Saved | `/reddit/saved` | Persistent favorites whose originals are protected from cache eviction. |
| Review | `/reddit/review` | Keep or reject uncertain candidates, choose a rejection reason in the viewer, and undo the previous decision exactly. |
| TV | `/reddit/tv` | Per-tab playback of kept, unseen memes, with pause, next, save, inspect, a 5-30 second interval, and explicit replay. Pause while the tab is hidden or the viewer is opened. |
| Settings | `/reddit/settings` | Local cache and playback settings, optional image analysis with spending limits, and per-source collection health. |

The detail sheet offers the original image, fit/zoom, previous/next navigation, image clipboard copy, Download original, and a link to the Reddit post. Mark an image seen only after its original loads. Keep rejected, duplicate, and unavailable images out of ordinary browsing while retaining archived metadata.

## Shared folder behavior

Create named folders from `/folders` or the Folders picker on an X attachment or Reddit meme. Folder names are trimmed, contain 1-80 characters, and are unique ignoring case. Search the folder list by name; open `/folders/<id>` to search saved titles or creators, filter by X or Reddit, inspect media, rename the folder, or delete it.

An item can belong to several folders. Save folders applies the exact checked destinations, including removals; uncheck one and check another to move an item. Cancelling discards unsaved placement changes. Creating a folder in the picker saves the new folder immediately and checks it, while placement still requires Save folders. Removing an item from one folder or deleting a folder keeps source media and placements in other folders.

Folder names, memberships, and media metadata persist locally under `.data/folders`. Saved Reddit items include an independent copy of the original image bytes, and the folder viewer offers Download original and the source post link. These copies survive collector cache eviction and are retained after folder removal. X items retain their saved archive reference and playback metadata; videos stream through the existing local proxy, with Refresh video link available when needed. Adding an X item to a folder does not create an offline media copy. See [shared folder documentation](docs/FOLDERS.md) for persistence, storage overrides, and backup details.

## Boundaries

Anonymous X media access cannot prove complete lifetime coverage or guarantee every account works. The X archive saves library records and streams media on demand; it is not a bulk offline downloader. Tweets uses the free public timeline and local archive imports, with no paid fallback. The optional dashboard can use its own official API token and is the only surface with demo data. Reply actions remain manual.

Reddit caches original image files and thumbnails locally; Download original returns the cached original, not a thumbnail or screenshot. Cache limits still apply to unprotected assets. Optional image analysis sends public images and titles to OpenAI only when configured and enabled, within spending limits. Analysis begins in shadow mode; influence on ranking requires successful human-label evaluation. Feedback and taste remain local. Normal startup does not send Discord messages.

One persistent X Media Node server owns the local application and supervises its Reddit collector child process. Each data directory has one server owner; do not run competing instances against it. The child uses a private loopback endpoint behind `/api/reddit/*`; the previous standalone HTML/CSS/JS app is not served or required. Reddit's SQLite database, originals, thumbnails, reviews, feedback, seen history, recommendation batches, settings, and analysis accounting live under `.data/reddit` by default. See [Reddit runtime and migration documentation](docs/REDDIT.md) for storage overrides and safe import/backup procedures.

This is a local, single-user app, not a public multi-user service. Published source must exclude personal collections, credentials, and local search reports.

## Interface

Use neutral surfaces, Geist typography, a blue primary action, compact controls, restrained borders, light/dark themes, visible focus, and reduced-motion support. Prioritize entering a username, understanding collection status, and browsing media over implementation details.

`DESIGN.md` remains the visual authority for both sources and shared folders. Reddit and Folders inherit the X Media header, theme controls, responsive media cards, and detail-sheet components. Folders use compact list rows and a checkbox picker; page actions stack below the title on mobile. Preserve the X archive's layout, collection queue, controls, and completeness language as these surfaces expand. Surface behavior is recorded in [.impeccable/surfaces/reddit.md](.impeccable/surfaces/reddit.md) and [.impeccable/surfaces/folders.md](.impeccable/surfaces/folders.md).
