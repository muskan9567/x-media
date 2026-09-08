import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

type Service = { origin: string; child: ChildProcess };
const shared = globalThis as typeof globalThis & { xMediaReddit?: Promise<Service> };

/** One collector per Next server, surviving development module reloads. IPC closes it with its parent. */
export function getRedditService(): Promise<Service> {
  if (shared.xMediaReddit) return shared.xMediaReddit;
  const pending = new Promise<Service>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "collectors", "reddit", "server.mjs")], {
      cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, PORT: "0", MEME_DATA_DIR: process.env.MEME_DATA_DIR || path.join(process.cwd(), ".data", "reddit") },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const reset = () => { if (shared.xMediaReddit === pending) shared.xMediaReddit = undefined; };
    const timer = setTimeout(() => { reset(); child.kill(); reject(new Error("The Reddit collector took too long to start. Check the server log and retry.")); }, 20000);
    child.once("error", (error) => { clearTimeout(timer); reset(); reject(error); });
    child.once("exit", () => {
      clearTimeout(timer); reset();
      reject(new Error("The Reddit collector stopped. Check the server log and retry."));
    });
    child.once("message", (message: { port?: number }) => {
      if (!message.port) return;
      clearTimeout(timer); resolve({ child, origin: `http://127.0.0.1:${message.port}` });
    });
  });
  shared.xMediaReddit = pending;
  return pending;
}
