# Performance and verification

## What makes saved searches fast

The browser retains up to five recent collections and 5,000 attachments in memory. Reopening one displays the cached collection while revalidating with the local server. A saved server-side lookup neither contacts X nor rewrites the archive state file. Changing filters or sort order operates on the loaded collection.

New collections use the first media page's author data where possible, then send persisted progress through server-sent events. Polling is the fallback when the event connection fails. The collector loads the older scraper only for legacy jobs. Workers yield after three pages to allow other new searches to run; a continuation does not consume an error retry.

Fresh searches and playback depend on network latency, provider availability, account history, and rate limits. There is no universal instant-search or complete-history guarantee. Timings from one computer or account are not a service-level promise.

## Automated verification

```sh
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
```

Vitest enforces minimum coverage of 90% for statements, functions, and lines and 80% for branches across included library and API modules. The suite uses deterministic fixtures; it does not prove current availability of a third-party service.

## Optional live checks

Start a production server, then replace `USERNAME` with a public account you want to collect:

```sh
node scripts/verify-archive-live.mjs http://127.0.0.1:3000 USERNAME
```

To time saved opens and fresh collection progress, first save that account in the app:

```sh
node scripts/benchmark-archive-speed.mjs http://127.0.0.1:3000 USERNAME
```

These scripts perform real collection requests, share the app's queue and cooldown, and save local reports under `.data/research`. Reports contain the chosen usernames and must stay out of public commits. A waiting state records an upstream limit rather than a successful complete archive. The benchmark is bounded to two minutes per fresh run; a queued job can remain scheduled afterward. Use **Stop collection** in the app if you no longer want it to continue.
