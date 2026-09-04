import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { eventSchema, type ArchiveCheckpoint, type ArchiveEvent } from "./archive-job-types";

export type ArchiveRunner = (username: string, signal: AbortSignal, checkpoint?: ArchiveCheckpoint) => AsyncIterable<ArchiveEvent>;
export const runArchiveWorker: ArchiveRunner = async function* (username, signal, checkpoint) {
  const child = spawn(process.execPath, [path.join(process.cwd(), "scripts/free-media-worker.mjs"), username, "10000", "--stream"], {
    cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
    // The worker never reads browser cookies or uses configured account credentials.
    env: { ...process.env, X_BEARER_TOKEN: "", X_SCRAPER_AUTH_TOKEN: "", X_SCRAPER_CT0: "" },
  });
  let timedOut = false;
  let spawnError: Error | undefined;
  const closed = new Promise<void>((resolve) => { child.once("close", () => resolve()); });
  child.once("error", (error) => { spawnError = error; });
  child.stdin.on("error", () => { /* Early worker exits close stdin. */ });
  child.stdin.end(JSON.stringify(checkpoint ?? null));
  const kill = () => { child.kill(); };
  const timer = setTimeout(() => { timedOut = true; kill(); }, 90_000);
  signal.addEventListener("abort", kill, { once: true });
  if (signal.aborted) kill();
  const lines = createInterface({ input: child.stdout });
  let done = false;
  try {
    for await (const line of lines) {
      if (signal.aborted) break;
      if (line.length > 4_000_000) throw new Error("Worker response was too large.");
      const event = eventSchema.parse(JSON.parse(line));
      done ||= event.type === "done";
      yield event;
    }
    await closed;
    if (spawnError) throw spawnError;
    if (!done && !signal.aborted) yield { type: "done", reason: timedOut ? "timeout" : "upstream" };
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", kill); lines.close(); kill(); await closed;
  }
};
