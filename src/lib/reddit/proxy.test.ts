import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyReddit } from "./proxy";

const service = async () => ({ origin: "http://127.0.0.1:12345" });
afterEach(() => vi.unstubAllGlobals());
describe("merged Reddit API", () => {
  it("forwards filters, feedback bodies, and download headers to the internal collector", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("image", { headers: { "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="meme.png"' } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await proxyReddit(new Request("http://localhost:3000/api/reddit/download/abc?size=thumb"), ["download", "abc"], service);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:12345/download/abc?size=thumb");
    expect(result.headers.get("content-disposition")).toContain("attachment");
    expect(await result.text()).toBe("image");
    fetcher.mockResolvedValue(new Response('{"ok":true}'));
    await proxyReddit(new Request("http://localhost:3000/api/reddit/feedback/abc", { method: "POST", body: '{"action":"favorite"}', headers: { Origin: "http://localhost:3000" } }), ["feedback", "abc"], service);
    expect(fetcher.mock.calls[1][1].body).toBe('{"action":"favorite"}');
  });
  it("rejects cross-origin mutations, oversized requests, and unrecognized paths without starting the collector", async () => {
    const start = vi.fn(service);
    expect((await proxyReddit(new Request("http://localhost:3000/api/reddit/settings", { method: "PATCH", headers: { Origin: "https://evil.example" } }), ["settings"], start)).status).toBe(403);
    expect((await proxyReddit(new Request("http://localhost:3000/api/reddit/settings", { method: "POST", body: "a".repeat(16385) }), ["settings"], start)).status).toBe(413);
    expect((await proxyReddit(new Request("http://localhost:3000/api/reddit/private"), ["..", "private"], start)).status).toBe(404);
    expect(start).not.toHaveBeenCalled();
  });
  it("uses the browser's validated Host when Next normalizes the URL to localhost", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    const request = new Request("http://localhost:3000/api/reddit/settings", { method: "PATCH", body: "{}", headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" } });
    expect((await proxyReddit(request, ["settings"], service)).status).toBe(200);
    const hostile = new Request("http://localhost:3000/api/reddit/settings", { method: "POST", headers: { Host: "evil.example", Origin: "http://evil.example" } });
    expect((await proxyReddit(hostile, ["settings"], service)).status).toBe(403);
  });
  it("streams events and returns a useful recoverable error when the collector fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("event: update\ndata: {}\n\n", { headers: { "Content-Type": "text/event-stream" } })));
    const response = await proxyReddit(new Request("http://localhost:3000/api/reddit/events"), ["events"], service);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toContain("event: update");
    const failed = await proxyReddit(new Request("http://localhost:3000/api/reddit/memes"), ["memes"], async () => { throw Error("Cannot start"); });
    expect(failed.status).toBe(503);
    expect((await failed.json()).error).toContain("preserved");
  });
});
