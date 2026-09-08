import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "@/lib/api-response";
import { atomicWrite } from "@/lib/tracker/archive-job-store";
import { folderNameSchema, folderStateSchema, mediaKey, type FolderMedia, type FolderState, type MediaReference } from "./types";

export type ResolvedMedia = { item: FolderMedia; bytes?: Uint8Array };
export class FolderStore {
  private state?: FolderState;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, private resolve: (reference: MediaReference) => Promise<ResolvedMedia>) {}

  private async load() {
    if (!this.state) {
      try { this.state = folderStateSchema.parse(JSON.parse(await readFile(path.join(this.directory, "state.json"), "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ApiError("Your folder library could not be read. The saved file has been preserved.", 503);
        this.state = { version: 1, folders: [], items: {} };
      }
    }
    return this.state;
  }
  private change<T>(action: (state: FolderState) => Promise<T> | T): Promise<T> {
    const operation = this.writes.then(async () => {
      const next = structuredClone(await this.load());
      const result = await action(next);
      folderStateSchema.parse(next);
      await atomicWrite(path.join(this.directory, "state.json"), next);
      this.state = next;
      return result;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  private async read() { await this.writes; return this.load(); }
  private folder(state: FolderState, id: string) {
    const folder = state.folders.find(item => item.id === id);
    if (!folder) throw new ApiError("Folder not found. It may have been deleted.", 404);
    return folder;
  }
  private summary(folder: FolderState["folders"][number]) {
    const { itemKeys, ...metadata } = folder;
    return { ...metadata, count: itemKeys.length };
  }
  private name(state: FolderState, value: string, except?: string) {
    const name = folderNameSchema.parse(value);
    if (state.folders.some(folder => folder.id !== except && folder.name.toLowerCase() === name.toLowerCase())) throw new ApiError("A folder with this name already exists.", 409);
    return name;
  }
  async list(key?: string) {
    const state = await this.read();
    return { folders: state.folders.map(folder => this.summary(folder)), memberships: state.folders.filter(folder => key && folder.itemKeys.includes(key)).map(folder => folder.id) };
  }
  async detail(id: string) {
    const state = await this.read(); const folder = this.folder(state, id);
    return structuredClone({ folder: this.summary(folder), items: folder.itemKeys.map(key => state.items[key]).filter(Boolean) });
  }
  create(name: string) {
    return this.change(state => {
      const now = new Date().toISOString();
      const folder = { id: randomUUID(), name: this.name(state, name), createdAt: now, updatedAt: now, itemKeys: [] };
      state.folders.push(folder); return this.summary(folder);
    });
  }
  rename(id: string, name: string) {
    return this.change(state => { const folder = this.folder(state, id); folder.name = this.name(state, name, id); folder.updatedAt = new Date().toISOString(); return this.summary(folder); });
  }
  delete(id: string) {
    return this.change(state => { this.folder(state, id); state.folders = state.folders.filter(folder => folder.id !== id); });
  }
  remove(id: string, key: string) {
    return this.change(state => { const folder = this.folder(state, id); folder.itemKeys = folder.itemKeys.filter(item => item !== key); folder.updatedAt = new Date().toISOString(); });
  }
  place(reference: MediaReference, ids: string[]) {
    return this.change(async state => {
      const destinations = [...new Set(ids)];
      destinations.forEach(id => this.folder(state, id));
      const key = mediaKey(reference);
      if (destinations.length && !state.items[key]) {
        const resolved = await this.resolve(reference);
        if (resolved.item.key !== key) throw new ApiError("This media could not be added.", 502);
        if (resolved.bytes && resolved.item.asset) {
          const directory = path.join(this.directory, "assets"); await mkdir(directory, { recursive: true });
          const file = `${createHash("sha256").update(key).digest("hex")}.bin`;
          const temporary = path.join(directory, `${randomUUID()}.tmp`);
          await writeFile(temporary, resolved.bytes);
          await rename(temporary, path.join(directory, file));
          resolved.item.asset.file = file;
        }
        state.items[key] = resolved.item;
      }
      for (const folder of state.folders) {
        const had = folder.itemKeys.includes(key), wants = destinations.includes(folder.id);
        if (wants && !had) folder.itemKeys.unshift(key);
        if (!wants && had) folder.itemKeys = folder.itemKeys.filter(item => item !== key);
        if (had !== wants) folder.updatedAt = new Date().toISOString();
      }
      return { memberships: destinations };
    });
  }
  async asset(key: string) {
    const state = await this.read(); const item = state.items[key];
    if (!item?.asset) throw new ApiError("Saved image not found.", 404);
    try { return { bytes: await readFile(path.join(this.directory, "assets", item.asset.file)), mime: item.asset.mime }; }
    catch { throw new ApiError("This saved image is unavailable. Open the original post.", 404); }
  }
}
