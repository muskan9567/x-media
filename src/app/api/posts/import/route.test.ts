import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseArchiveFiles, MAX_ARCHIVE_BYTES } from "@/lib/posts/archive-import";
const service = vi.hoisted(() => ({ importArchive: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/posts/service", () => ({ getPostsService: async () => service }));
import { POST } from "./route";
import { GET } from "../export/route";
const archive = () => parseArchiveFiles([
  { name: "account.js", text: '[{"account":{"accountId":"123","username":"example"}}]' },
  { name: "tweets.js", text: '[{"tweet":{"id_str":"999999999999999999","full_text":"Imported tweet","created_at":"2020-01-01"}}]' },
]);
const request = (body: string, headers = {}) => new Request("http://localhost/api/posts/import", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
beforeEach(() => vi.resetAllMocks());
describe("archive import/export routes", () => {
  it("imports validated records through the manager and never returns private account fields", async () => {
    service.importArchive.mockResolvedValue({ username: "example", posts: [] });
    const result = await POST(request(JSON.stringify(archive())));
    expect(result.status).toBe(200); expect(service.importArchive).toHaveBeenCalledOnce();
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects cross-site writes, wrong content types, malformed data, and account mismatches", async () => {
    expect((await POST(request("{}", { origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request("{}", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await POST(request("{}", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request("{"))).status).toBe(400);
    const invalid = archive(); invalid.posts[0].authorId = "wrong";
    expect((await POST(request(JSON.stringify(invalid)))).status).toBe(422);
    expect(service.importArchive).not.toHaveBeenCalled();
  });
  it("bounds a streamed upload without trusting Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_ARCHIVE_BYTES * 2 + 1)); controller.close(); } });
    const req = new Request("http://localhost/api/posts/import", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body: stream, duplex: "half" } as RequestInit);
    expect((await POST(req)).status).toBe(413); expect(service.importArchive).not.toHaveBeenCalled();
  });
  it("exports only a portable profile and posts, excluding internal checkpoints", async () => {
    const data = archive(); service.get.mockResolvedValue({ ...data, cursor: "internal", runId: "internal" });
    const result = await GET(new Request("http://localhost/api/posts/export?username=Example"));
    expect(result.headers.get("content-disposition")).toBe('attachment; filename="example-tweets.json"');
    expect(await result.json()).toEqual(data);
    service.get.mockResolvedValue({ posts: [] }); expect((await GET(new Request("http://localhost/api/posts/export?username=example"))).status).toBe(409);
  });
});
