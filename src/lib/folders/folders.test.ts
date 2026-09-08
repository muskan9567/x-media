import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FolderStore, type ResolvedMedia } from "./store";
import { foldersRequest } from "./api";
import { mediaKey, type MediaReference } from "./types";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const reddit: MediaReference = { source: "reddit", id: "abc123" };
function resolved(reference: MediaReference): ResolvedMedia {
  return { item: { key: mediaKey(reference), reference, title: "A coding meme", creator: "r/programmerhumor", postUrl: "https://www.reddit.com/r/programmerhumor/comments/abc123", previewUrl: `/api/folders/assets/${encodeURIComponent(mediaKey(reference))}`, type: "photo", addedAt: new Date().toISOString(), asset: { file: `${"0".repeat(64)}.bin`, mime: "image/png" } }, bytes: new Uint8Array([137, 80, 78, 71]) };
}
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "x-media-folders-")); directories.push(directory);
  const resolve = vi.fn(async (reference: MediaReference) => resolved(reference));
  return { directory, resolve, store: new FolderStore(directory, resolve) };
}

describe("persistent folders", () => {
  it("normalizes names, disallows duplicates, and supports renaming", async () => {
    const { store } = await setup(); const folder = await store.create("  Coding   memes  ");
    expect(folder.name).toBe("Coding memes");
    await expect(store.create("CODING MEMES")).rejects.toThrow("already exists");
    await expect(store.create("   ")).rejects.toThrow();
    await expect(store.create("a".repeat(81))).rejects.toThrow();
    await store.rename(folder.id, "Favorites");
    expect((await store.list()).folders[0].name).toBe("Favorites");
  });
  it("keeps mixed-source memberships and original bytes across a restart", async () => {
    const { store, directory, resolve } = await setup();
    const a = await store.create("Coding"), b = await store.create("Share later");
    await store.place(reddit, [a.id, b.id, b.id]);
    await store.place({ source: "x", id: reddit.id, jobId: randomUUID() }, [a.id]);
    const restarted = new FolderStore(directory, resolve);
    expect((await restarted.detail(a.id)).items.map(item => item.key)).toEqual(["x:abc123", "reddit:abc123"]);
    expect((await restarted.list("reddit:abc123")).memberships).toEqual([a.id, b.id]);
    expect([...((await restarted.asset("reddit:abc123")).bytes)]).toEqual([137, 80, 78, 71]);
    expect((await restarted.list()).folders.map(folder => folder.count)).toEqual([2, 1]);
  });
  it("moves items without refetching and removes only the chosen placement", async () => {
    const { store, resolve } = await setup(); const a = await store.create("A"), b = await store.create("B");
    await store.place(reddit, [a.id]); await store.place(reddit, [b.id]);
    expect((await store.detail(a.id)).items).toEqual([]);
    expect(resolve).toHaveBeenCalledTimes(1);
    await store.place(reddit, [a.id, b.id]); await store.remove(a.id, mediaKey(reddit)); await store.delete(a.id);
    expect((await store.detail(b.id)).items).toHaveLength(1);
    await store.place(reddit, []); expect((await store.detail(b.id)).items).toHaveLength(0);
    expect(await store.asset(mediaKey(reddit))).toHaveProperty("mime", "image/png");
  });
  it("serializes concurrent changes without losing folders or memberships", async () => {
    const { store } = await setup(); const folders = await Promise.all(Array.from({ length: 12 }, (_, i) => store.create(`Folder ${i}`)));
    await Promise.all(folders.map((folder, i) => store.place({ source: "reddit", id: `meme${i}` }, [folder.id])));
    expect((await store.list()).folders.map(folder => folder.count)).toEqual(Array(12).fill(1));
  });
  it("rejects unknown destinations atomically before fetching media", async () => {
    const { store, resolve } = await setup(); const a = await store.create("A");
    await expect(store.place(reddit, [a.id, randomUUID()])).rejects.toThrow("not found");
    expect(resolve).not.toHaveBeenCalled(); expect((await store.detail(a.id)).items).toEqual([]);
  });
  it("preserves state when media resolution fails and allows a later retry", async () => {
    const { store, resolve } = await setup(); const a = await store.create("A");
    resolve.mockRejectedValueOnce(new Error("offline")); await expect(store.place(reddit, [a.id])).rejects.toThrow("offline");
    expect((await store.detail(a.id)).items).toEqual([]); await store.place(reddit, [a.id]); expect((await store.detail(a.id)).items).toHaveLength(1);
  });
  it("preserves a corrupt state file rather than replacing the library", async () => {
    const { store, directory } = await setup(); await writeFile(path.join(directory, "state.json"), "broken");
    await expect(store.create("New")).rejects.toThrow("preserved"); expect(await readFile(path.join(directory, "state.json"), "utf8")).toBe("broken");
  });
  it("does not use folder names as paths and keeps returned state isolated", async () => {
    const { store } = await setup(); const a = await store.create("../special <folder>"); await store.place(reddit, [a.id]);
    const detail = await store.detail(a.id); detail.items[0].title = "edited";
    expect((await store.detail(a.id)).items[0].title).toBe("A coding meme");
    await expect(store.asset("../../outside")).rejects.toThrow("not found");
    await expect(store.rename(randomUUID(), "X")).rejects.toThrow("not found");
  });
});

describe("folder API", () => {
  function request(segments: string[], store: FolderStore, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
    return foldersRequest(new Request(`http://localhost:3000/api/folders/${segments.join("/")}`, { method, headers: { host: "127.0.0.1:3000", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) }), segments, store);
  }
  it("creates, places, fetches, downloads, renames, removes and deletes through routes", async () => {
    const { store } = await setup();
    const created = await request([], store, "POST", { name: "Coding" }, { origin: "http://127.0.0.1:3000" }); expect(created.status).toBe(200);
    const { id } = await created.json();
    expect((await request(["memberships"], store, "PUT", { media: reddit, folderIds: [id] })).status).toBe(200);
    expect((await (await request([id], store)).json()).items).toHaveLength(1);
    const asset = await request(["assets", "reddit:abc123"], store); expect(asset.headers.get("content-type")).toBe("image/png"); expect((await asset.arrayBuffer()).byteLength).toBe(4);
    expect((await request([id], store, "PATCH", { name: "Renamed" })).status).toBe(200);
    expect((await request([id, "items", "reddit:abc123"], store, "DELETE")).status).toBe(200);
    expect((await request([id], store, "DELETE")).status).toBe(200);
    expect((await request([id], store)).status).toBe(404);
    expect((await (await request([], store)).json()).folders).toEqual([]);
  });
  it.each<Record<string, string>>([
    { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { host: "evil.example" },
  ])("rejects foreign requests: %j", async headers => {
    const { store } = await setup(); expect((await request([], store, "POST", { name: "A" }, headers)).status).toBe(403);
    expect((await store.list()).folders).toEqual([]);
  });
  it("rejects arbitrary media URLs, malformed payloads and oversized input", async () => {
    const { store } = await setup();
    expect((await request(["memberships"], store, "PUT", { media: { source: "reddit", id: "abc123", url: "http://internal/secret" }, folderIds: [] })).status).toBe(422);
    expect((await request(["memberships"], store, "PUT", { media: { source: "reddit", id: "../secret" }, folderIds: [] })).status).toBe(422);
    expect((await request([], store, "POST", { name: "A".repeat(17000) })).status).toBe(413);
    expect((await foldersRequest(new Request("http://localhost/api/folders", { method: "POST", body: "{" }), [], store)).status).toBe(422);
  });
  it("returns errors for unsupported operations and missing assets", async () => {
    const { store } = await setup(); expect((await request([randomUUID()], store, "PUT", {})).status).toBe(405);
    expect((await request(["assets", "missing"], store)).status).toBe(404);
    expect((await request(["extra", "path", "here"], store)).status).toBe(404);
  });
});
