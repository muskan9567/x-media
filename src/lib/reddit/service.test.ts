import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { getRedditService } from "./service";
const shared = globalThis as typeof globalThis & { xMediaReddit?: unknown };
let child: EventEmitter & { kill: ReturnType<typeof vi.fn> };
beforeEach(() => { vi.useFakeTimers(); delete shared.xMediaReddit; child = Object.assign(new EventEmitter(), { kill: vi.fn() }); mocks.spawn.mockReturnValue(child); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); delete shared.xMediaReddit; });
it("starts one IPC collector for concurrent callers and restarts after exit", async () => {
  const first = getRedditService(); expect(getRedditService()).toBe(first);
  child.emit("message", { port: 4567 }); expect((await first).origin).toBe("http://127.0.0.1:4567");
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ windowsHide: true, stdio: ["ignore", "inherit", "inherit", "ipc"], env: { PORT: "0" } });
  child.emit("exit", 0);
  const next = getRedditService(); child.emit("message", { port: 4568 }); expect((await next).origin).toContain("4568");
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
});
it("reports startup errors and permits a retry even when no exit event follows", async () => {
  const first = getRedditService(); const assertion = expect(first).rejects.toThrow("ENOENT"); child.emit("error", Error("ENOENT")); await assertion;
  const next = getRedditService(); child.emit("message", { port: 4568 }); await next;
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
});
it("times out a silent worker and does not let its late exit clear a newer worker", async () => {
  const first = getRedditService(); const assertion = expect(first).rejects.toThrow("too long"); child.emit("message", {});
  await vi.advanceTimersByTimeAsync(20000); await assertion; expect(child.kill).toHaveBeenCalled();
  const previous = child; child = Object.assign(new EventEmitter(), { kill: vi.fn() }); mocks.spawn.mockReturnValue(child);
  const next = getRedditService(); child.emit("message", { port: 5555 }); await next;
  previous.emit("exit", 1); expect(getRedditService()).toBe(next);
});
it("reports early collector exit", async () => {
  const first = getRedditService(); const assertion = expect(first).rejects.toThrow("stopped"); child.emit("exit", 1); await assertion;
});
