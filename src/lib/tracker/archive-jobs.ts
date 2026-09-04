import "server-only";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ArchiveJobManager } from "./archive-job-manager";
import { ArchiveJobStore } from "./archive-job-store";

const shared = globalThis as typeof globalThis & { signalDeskArchiveJobs?: Promise<ArchiveJobManager> };
export function getArchiveJobs(): Promise<ArchiveJobManager> {
  shared.signalDeskArchiveJobs ??= (async () => {
    const directory = path.join(process.cwd(), ".data", "archive-jobs");
    await mkdir(directory, { recursive: true });
    const lock = path.join(directory, "process.lock");
    try {
      const pid = Number(await readFile(lock, "utf8"));
      let alive = false;
      if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch { /* Previous server exited. */ } }
      if (alive && pid !== process.pid) throw new Error("Another X Media server owns the archive queue. Stop it before starting this instance.");
      await unlink(lock);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const handle = await open(lock, "wx");
    try { await handle.writeFile(String(process.pid)); } finally { await handle.close(); }
    const manager = new ArchiveJobManager(new ArchiveJobStore(directory, path.join(process.cwd(), ".data", "media-archive-cache")));
    await manager.init();
    return manager;
  })();
  return shared.signalDeskArchiveJobs;
}
