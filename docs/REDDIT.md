# Reddit in X Media

The **Reddit** tab at `/reddit` uses the same header, colors, typography, theme controls, cards, and sheet viewer as the X archive. The X home page and its archive queue retain their existing behavior.

## Browse and curate

- **All memes:** search titles, communities, tags and analyzed image text; filter S/A/B ranks and communities; sort by quality, date or votes; load more results.
- **For you:** stable recommendation batches based on explicit feedback and seen history, with **Next batch**.
- **Saved:** favorites preserved across restart, with originals protected from cache eviction.
- **Review:** keep or reject uncertain candidates. Choose a rejection reason in the viewer. **Undo** restores the previous decision exactly.
- **Viewer:** original image, zoom, image clipboard copy, original download, Reddit source, previous/next, and Escape to close. Originals are marked seen after they load.
- **TV:** kept, unseen memes with per-tab playback; pause, next, save, inspect, adjustable 5–30 second intervals and explicit replay. Playback pauses in a hidden tab and when the viewer is opened.
- **Settings:** cache size, TV interval, optional image analysis and spending limits, and per-source collection health. No key is needed for collecting memes.

The collector checks 14 focused AI/coding communities every three minutes. Remote services can be unavailable or rate-limited; source failures retain the collection and use bounded retries. Rejected, duplicate and unavailable images do not appear in ordinary browsing. Archived metadata remains preserved. Optional analysis retains the original budget and evaluation gates. Normal startup does not send Discord messages.

## Runtime and storage

Use Node 26+. Next.js supervises `collectors/reddit/server.mjs` through an IPC child process. It binds to an automatically assigned loopback port, shuts down and checkpoints SQLite when the parent exits, and is accessed through the allowlisted `/api/reddit/*` routes. Same-origin checks guard browser mutations. The old HTML/CSS/JS app is not served or required.

The authoritative data is `.data/reddit/runtime/finder.sqlite`; cached originals and thumbnails are in `.data/reddit/runtime/assets`. Reviews, feedback, seen history, recommendation batches, source cursors, settings, analysis results and spending all live in SQLite. `MEME_DATA_DIR` can select a different store. `MEME_OFFLINE=1` serves existing data without remote collection.

Back up the data folder with X Media stopped, or use SQLite's backup API for a live database. Do not copy only a live `.sqlite` file while ignoring its WAL. Personal collections and credentials are ignored by Git.

## Import a previous collector

Stop the previous collector and its startup task, then run from the X Media project root:

```powershell
node scripts/import-reddit.mjs C:\path\to\reddit-ai-meme-bot
```

The importer creates `.data/reddit` using SQLite's consistent backup API, copies original images, thumbnails, legacy image caches, exported memes and delivery receipts, checks database integrity, and writes `import-report.json`. An existing destination is never overwritten. The source stays intact; retire its launcher and archive its folder after checking the merged app. An optional second argument selects an isolated destination for testing.

## Windows launch

After `npm run build`, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-x-media.ps1 -Open`. The launcher starts the production app hidden, checks local tweet storage, and reuses a healthy existing instance. Reddit starts independently so a collector delay cannot block the other tabs. `-Port 3101` selects another port. It also redirects old port-8321 bookmarks to the merged UI. It does not enable message delivery.

## Verification

`npm test` runs the X Media/API tests plus the bundled Reddit tests, including migration with committed WAL data, persistence, undo, asset handling, ranking, budgets and mocked delivery. `npm run build` includes TypeScript validation.

For browser testing, make a separate imported data directory and start an offline server with `MEME_DATA_DIR` pointed at it. Then run `node scripts/test-reddit-browser.mjs`; `X_MEDIA_TEST_URL` overrides port 3000. The script uses installed Chrome headlessly, tests search/filter/pagination, saving, undo, downloads, clipboard, settings, TV and X navigation, and captures desktop/mobile views. It deliberately changes only the test copy.

The CLI and human-label evaluation tools remain under `collectors/reddit/`. Run them from the project root. The CLI uses `/api/reddit` on the merged server; stop X Media before an evaluation command that takes the database lock.
