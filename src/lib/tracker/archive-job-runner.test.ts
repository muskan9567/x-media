import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { runArchiveWorker } from "./archive-job-runner";
function child() {
  const process = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  let closed = false;
  process.kill.mockImplementation(() => {
    if (!closed) { closed = true; process.stdout.end(); process.emit("close", 0); }
  });
  mocks.spawn.mockReturnValue(process);
  return process;
}
afterEach(() => { vi.useRealTimers(); mocks.spawn.mockReset(); });
describe("streaming worker boundary", () => {
  it("delivers progress before exit and scrubs account credentials", async () => {
    const p = child(); const controller = new AbortController();
    const stream = runArchiveWorker("example", controller.signal)[Symbol.asyncIterator]();
    const pending = stream.next();
    p.stdout.write(JSON.stringify({ type: "batch", items: [], postsScanned: 10, batchesRead: 1 }) + "\n");
    expect((await pending).value).toMatchObject({ type: "batch", postsScanned: 10 });
    expect(p.kill).not.toHaveBeenCalled();
    const options = mocks.spawn.mock.calls[0][2];
    expect(options.env.X_BEARER_TOKEN).toBe(""); expect(options.env.X_SCRAPER_AUTH_TOKEN).toBe("");
    await stream.return?.(); expect(p.kill).toHaveBeenCalled();
  });
  it("keeps delivered batches when the child exits without a final event", async () => {
    const p = child(); const stream = runArchiveWorker("example", new AbortController().signal)[Symbol.asyncIterator]();
    const pending = stream.next(); p.stdout.write('{"type":"batch","items":[],"postsScanned":10,"batchesRead":1}\n');
    expect((await pending).value?.type).toBe("batch");
    const next = stream.next(); p.kill(); expect((await next).value).toEqual({ type: "done", reason: "upstream" }); await stream.return?.();
  });
  it("terminates a stalled child and reports timeout", async () => {
    vi.useFakeTimers(); const p = child(); const stream = runArchiveWorker("example", new AbortController().signal)[Symbol.asyncIterator]();
    const next = stream.next(); await vi.advanceTimersByTimeAsync(90_000);
    expect((await next).value).toEqual({ type: "done", reason: "timeout" });
    await stream.return?.(); expect(p.kill).toHaveBeenCalled();
  });
  it("rejects malformed records and always terminates the child", async () => {
    const p = child(); const stream = runArchiveWorker("example", new AbortController().signal)[Symbol.asyncIterator]();
    const next = stream.next(); p.stdout.write('{"type":"unexpected"}\n');
    await expect(next).rejects.toThrow(); expect(p.kill).toHaveBeenCalled();
  });
});
