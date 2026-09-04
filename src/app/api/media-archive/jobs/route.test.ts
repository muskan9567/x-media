import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), retry: vi.fn(), repair: vi.fn() }));
vi.mock("@/lib/tracker/archive-jobs", () => ({ getArchiveJobs: async () => mocks }));
import { GET, POST } from "./route";
import { GET as getJob, POST as action } from "./[id]/route";
const req = (body: unknown) => new Request("http://localhost/api/media-archive/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "job-id" }) };
beforeEach(() => { for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue({}); });
describe("anonymous collection routes", () => {
  it("validates username and rejects credential fields", async () => {
    expect((await POST(req({ username: "../escape" }))).status).toBe(422);
    expect((await POST(req({ username: "example", token: "secret" }))).status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await POST(req({ username: " @Example ", refresh: true }))).status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith("example", true);
  });
  it("lists and polls without HTTP caching", async () => {
    expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
    expect((await getJob(req({}), context)).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith("job-id");
  });
  it("dispatches cancel, retry and media repair with strict arguments", async () => {
    expect((await action(req({ action: "delete" }), context)).status).toBe(422);
    expect((await action(req({ action: "repair", postId: "../../a" }), context)).status).toBe(422);
    await action(req({ action: "cancel" }), context); expect(mocks.cancel).toHaveBeenCalledWith("job-id");
    await action(req({ action: "retry" }), context); expect(mocks.retry).toHaveBeenCalledWith("job-id");
    await action(req({ action: "repair", postId: "123" }), context); expect(mocks.repair).toHaveBeenCalledWith("job-id", "123");
  });
});
