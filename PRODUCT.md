# X Media product boundaries

X Media is a personal local workspace for browsing public X (Twitter) media by username. The archive is the home page. A separate dashboard at `/dashboard` retains watchlist and manual review tools.

## Core behavior

- Accept public usernames without a login, cookies, API key, or paid provider.
- Preserve every supported attachment returned for the requested author's posts.
- Present videos first, with photo, GIF, all-media, and chronological controls.
- Save collections locally, reopen them quickly, and merge later discoveries.
- Show saved batches while a resumable, cancellable collection runs.
- Treat unavailable and incomplete upstream responses honestly; never substitute demo archive media.

## Boundaries

Public access cannot prove complete lifetime coverage or guarantee every account works. The app saves library records and streams media on demand; it is not a bulk offline downloader. Only the optional dashboard has demo data or an official API token. Reply actions remain manual.

One persistent Node server owns each data directory. This is a local, single-user app, not a public multi-user service. Published source must exclude personal collections, credentials, and local search reports.

## Interface

Use neutral surfaces, Geist typography, a blue primary action, compact controls, restrained borders, light/dark themes, visible focus, and reduced-motion support. Prioritize entering a username, understanding collection status, and browsing media over implementation details.
