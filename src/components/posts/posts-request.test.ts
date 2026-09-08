import { afterEach, describe, expect, it, vi } from "vitest";
import { postsJson, postsRequest } from "./posts-request";

afterEach(() => vi.unstubAllGlobals());
describe("tweet connection recovery", () => {
  it("explains how to recover when the local server is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(postsRequest("/api/posts")).rejects.toThrow("desktop shortcut");
  });
  it("preserves cancellation when switching accounts", async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));
    await expect(postsRequest("/api/posts", { signal: controller.signal })).rejects.toBe(controller.signal.reason);
  });
  it("bounds requests and preserves conditional polling responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 304 })); vi.stubGlobal("fetch", fetcher);
    const response = await postsRequest("/api/posts", { headers: { "If-None-Match": '"1"' } });
    expect(response.status).toBe(304);
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetcher.mock.calls[0][1].headers).toEqual({ "If-None-Match": '"1"' });
  });
  it("gives a retry message for incomplete responses instead of a JSON parser error", async () => {
    await expect(postsJson(new Response("<html>Restarting</html>"))).rejects.toThrow("finished starting");
  });
});
