import { beforeEach, describe, expect, it, vi } from "vitest";
const service = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/posts/service", () => ({ getPostsService: async () => service }));
import { GET, POST } from "./route";
beforeEach(() => vi.resetAllMocks());
describe("posts API", () => {
  it("lists saved accounts and supports conditional polling", async () => {
    service.list.mockResolvedValue([]); expect(await (await GET(new Request("http://localhost/api/posts"))).json()).toEqual({ accounts: [] });
    service.get.mockResolvedValue({ revision: 3, status: "ready" });
    const first = await GET(new Request("http://localhost/api/posts?username=example")); expect(first.headers.get("cache-control")).toBe("no-store");
    const next = await GET(new Request("http://localhost/api/posts?username=example", { headers: { "if-none-match": first.headers.get("etag")! } })); expect(next.status).toBe(304);
    const legacy = await GET(new Request("http://localhost/api/posts?username=example", { headers: { "if-none-match": '"3-ready-0"' } })); expect(legacy.status).toBe(200);
  });
  it("normalizes input and dispatches all supported actions", async () => {
    service.start.mockResolvedValue({ status: "queued" }); service.stop.mockResolvedValue({ status: "paused" });
    for (const action of ["open", "continue", "refresh", "stop"]) {
      const response = await POST(new Request("http://localhost/api/posts", { method: "POST", body: JSON.stringify({ username: "https://x.com/Example", action }) })); expect(response.status).toBe(200);
    }
    expect(service.start).toHaveBeenCalledWith("example", "refresh"); expect(service.stop).toHaveBeenCalledWith("example");
  });
  it("rejects cross-origin, oversized, invalid JSON and invalid usernames", async () => {
    const call = (body: string, origin?: string) => POST(new Request("http://localhost/api/posts", { method: "POST", body, headers: origin ? { origin } : {} }));
    expect((await call("{}", "https://evil.test")).status).toBe(403);
    expect((await call("x".repeat(2049))).status).toBe(413);
    expect((await call("{")).status).toBe(400);
    expect((await call('{"username":"../bad"}')).status).toBe(422);
    expect((await call('{"username":"example","action":"erase"}')).status).toBe(422);
  });
  it("accepts the public Host when Next supplies an internal request hostname", async () => {
    service.start.mockResolvedValue({ status: "queued" });
    const response = await POST(new Request("http://localhost:3000/api/posts", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }, body: '{"username":"example"}' }));
    expect(response.status).toBe(200); expect(service.start).toHaveBeenCalledWith("example", "open");
  });
  it("preserves errors crossing the instrumentation and route bundle boundary", async () => {
    service.get.mockRejectedValue(Object.assign(new Error("Account not found"), { name: "ApiError", status: 404 }));
    const response = await GET(new Request("http://localhost/api/posts?username=missing"));
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "Account not found" });
  });
});
