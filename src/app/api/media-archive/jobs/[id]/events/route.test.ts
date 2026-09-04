import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-response";
const mocks = vi.hoisted(() => ({ get: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/lib/tracker/archive-jobs", () => ({ getArchiveJobs: async () => mocks }));
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "job-id" }) };
const snapshot = (status = "running", posts = 0) => ({ job: { id: "job-id", status, postsScanned: posts, message: status, newItems: posts },
  result: { displayName: "Example", items: [] } });
let publish: () => void, unsubscribe: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(snapshot()); unsubscribe = vi.fn();
  mocks.subscribe.mockReset().mockImplementation((listener) => { publish = listener; return unsubscribe; });
});
afterEach(() => vi.restoreAllMocks());
describe("live collection updates", () => {
  it("sends initial progress and a saved page immediately, then closes at completion", async () => {
    const response = await GET(new Request("http://localhost/events"), context);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const reader = response.body!.getReader(); const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('"status":"running"');
    mocks.get.mockResolvedValue(snapshot("running", 100)); publish();
    expect(decoder.decode((await reader.read()).value)).toContain('"postsScanned":100');
    mocks.get.mockResolvedValue(snapshot("partial", 100)); publish();
    expect(decoder.decode((await reader.read()).value)).toContain('"status":"partial"');
    expect((await reader.read()).done).toBe(true); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("cleans up on reader cancellation and request abort", async () => {
    const controller = new AbortController();
    const response = await GET(new Request("http://localhost/events", { signal: controller.signal }), context);
    const reader = response.body!.getReader(); await reader.read(); controller.abort();
    expect((await reader.read()).done).toBe(true); expect(unsubscribe).toHaveBeenCalledOnce();
    const second = await GET(new Request("http://localhost/events"), context);
    await second.body!.cancel(); expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
  it("validates missing collections before starting a stream", async () => {
    mocks.get.mockRejectedValue(new ApiError("Collection not found.", 404));
    const response = await GET(new Request("http://localhost/events"), context);
    expect(response.status).toBe(404); expect(mocks.subscribe).not.toHaveBeenCalled();
  });
  it("does not resend a gallery for checkpoint-only changes", async () => {
    const response = await GET(new Request("http://localhost/events"), context);
    const reader = response.body!.getReader(); await reader.read();
    publish(); await new Promise(resolve => setTimeout(resolve, 0));
    mocks.get.mockResolvedValue(snapshot("partial", 1)); publish();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"status":"partial"');
    expect((await reader.read()).done).toBe(true);
  });
});
