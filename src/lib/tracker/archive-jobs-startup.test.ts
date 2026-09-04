import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mkdir: vi.fn(), readFile: vi.fn(), unlink: vi.fn(), open: vi.fn(), writeFile: vi.fn(), close: vi.fn(), init: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, readFile: mocks.readFile, unlink: mocks.unlink, open: mocks.open }));
vi.mock("./archive-job-manager", () => ({ ArchiveJobManager: class { init = mocks.init; } }));
vi.mock("./archive-job-store", () => ({ ArchiveJobStore: class {} }));
const shared = globalThis as typeof globalThis & { signalDeskArchiveJobs?: unknown };
beforeEach(() => {
  delete shared.signalDeskArchiveJobs; vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue(undefined);
  mocks.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
  mocks.open.mockResolvedValue({ writeFile: mocks.writeFile, close: mocks.close });
});
afterEach(() => { delete shared.signalDeskArchiveJobs; vi.restoreAllMocks(); });
describe("archive startup ownership", () => {
  it("initializes once and claims the process lock before recovering jobs", async () => {
    const { getArchiveJobs } = await import("./archive-jobs");
    const [a, b] = await Promise.all([getArchiveJobs(), getArchiveJobs()]);
    expect(a).toBe(b); expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).toHaveBeenCalledWith(String(process.pid)); expect(mocks.close).toHaveBeenCalled();
  });
  it("reclaims a dead process lock", async () => {
    mocks.readFile.mockResolvedValue("999999"); vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("dead"); });
    const { getArchiveJobs } = await import("./archive-jobs"); await getArchiveJobs();
    expect(mocks.unlink).toHaveBeenCalled(); expect(mocks.init).toHaveBeenCalled();
  });
  it("refuses a second live server and leaves its lock intact", async () => {
    mocks.readFile.mockResolvedValue(String(process.pid + 1)); vi.spyOn(process, "kill").mockReturnValue(true);
    const { getArchiveJobs } = await import("./archive-jobs");
    await expect(getArchiveJobs()).rejects.toThrow("Another X Media"); expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it("recovers a same-process or invalid stale marker without creating duplicate managers", async () => {
    mocks.readFile.mockResolvedValue(String(process.pid)); vi.spyOn(process, "kill").mockReturnValue(true);
    const { getArchiveJobs } = await import("./archive-jobs"); await getArchiveJobs(); expect(mocks.init).toHaveBeenCalledTimes(1);
  });
});
