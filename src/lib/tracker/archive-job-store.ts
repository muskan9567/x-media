import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { accountSchema, archiveItemSchema, emptyAccount, stateSchema, usernameSchema, type ArchiveState } from "./archive-job-types";

export async function atomicWrite(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => undefined); }
}
export class ArchiveJobStore {
  readonly file: string;
  constructor(readonly directory: string, readonly legacyDirectory: string) { this.file = path.join(directory, "state.json"); }
  async load(): Promise<ArchiveState> {
    try { return stateSchema.parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Saved archive state could not be read. The original file has been preserved."); }
    const state: ArchiveState = { version: 1, cooldownUntil: 0, accounts: {}, jobs: {} };
    let files: string[];
    try { files = await readdir(this.legacyDirectory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files = [];
    }
    for (const file of files.filter((name) => /^[a-zA-Z0-9_]{1,15}\.json$/.test(name))) {
      try {
        const legacy = JSON.parse(await readFile(path.join(this.legacyDirectory, file), "utf8"));
        const username = usernameSchema.parse(file.slice(0, -5));
        if (legacy.result?.access !== "guest" || legacy.result?.username?.toLowerCase() !== username) continue;
        const items = (legacy.result.items as unknown[]).flatMap((raw) => {
          const item = archiveItemSchema.safeParse(raw);
          return item.success && new URL(item.data.postUrl).pathname.split("/")[1].toLowerCase() === username ? [item.data] : [];
        });
        state.accounts[username] = accountSchema.parse({ ...emptyAccount(username), ...legacy.result, items,
          batchesRead: legacy.result.pagesFetched, collectedAt: new Date(legacy.fetchedAt).toISOString() });
      } catch { /* Invalid legacy copies stay untouched and are not imported. */ }
    }
    return state;
  }
  async save(state: ArchiveState) { await atomicWrite(this.file, stateSchema.parse(state)); }
}
