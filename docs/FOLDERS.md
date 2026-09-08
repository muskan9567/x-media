# Shared media folders

The shared **Folders** navigation opens `/folders`. Use **New folder** there, or the **Folders** button on an X attachment or Reddit meme. The picker supports multiple placements. Changes to checkboxes apply when **Save folders** is selected; creating a folder creates it immediately. Cancelling the picker leaves existing placements unchanged.

Each folder at `/folders/<id>` supports title/creator search, X/Reddit filtering, media inspection, renaming, and deletion. Uncheck the current folder and check a different one in the picker to move media. The remove control deletes only that placement. Folder deletion keeps source media and placements in other folders.

## Persistence

`.data/folders/state.json` contains versioned folder names, UUIDs, source-prefixed item keys, memberships, and metadata snapshots. Writes are serialized, validated, and atomically replaced. Failed writes do not update in-memory state; unreadable existing files are preserved and reported as errors. Run one X Media process per project, as enforced by the existing archive ownership lock. `MEDIA_FOLDERS_DIR` overrides the folder directory for an isolated test or alternate store.

Adding a Reddit meme copies its original bytes into `.data/folders/assets`. These copies are independent of the expendable collector cache and retain their original image format. Folder removal retains saved metadata and copies so later placements can work without another remote fetch. These retained copies are outside the Reddit cache-size setting; include them when backing up `.data` with X Media stopped.

X attachments retain the saved job reference and full playback metadata. Videos continue to stream through the existing local range proxy, and **Refresh video link** uses the existing repair action. Foldering X media does not make an offline video copy.

## API and validation

`/api/folders/*` is loopback-only and rejects foreign origins. Creation and rename validate trimmed names (1–80 characters, unique ignoring case). Membership writes accept only existing collector/job references, never arbitrary client-supplied media URLs. An unknown destination aborts the whole change. Reddit originals are fetched from the supervised collector and served with image MIME validation and `nosniff`.

## Verification

`src/lib/folders/folders.test.ts` covers persistence/restart, concurrent writes, mixed sources, multiple placements, moving/removing/deleting, rollback on resolution failure, corrupt-file preservation, validation, and API origin checks. `service.test.ts` checks authoritative resolution, fixed upstream image routes, and invalid originals.

For a browser run, stop X Media, start the built app with `MEDIA_FOLDERS_DIR` set to a new isolated directory, then run `FOLDERS_TEST=1 node scripts/test-folders-browser.mjs` (set the variable using your shell's syntax). The script requires an empty folder library and real saved X videos/Reddit images. It changes the isolated folder library only, leaving source feedback untouched. It exercises creation, multiple placements, mixed-source browsing, reload, search, filters, downloads, nested dialogs, moving, renaming, removal, deletion, and desktop/mobile layouts. `X_MEDIA_TEST_URL` selects another local address. Restart without the override afterward.
