import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "@/lib/api-response";
import { atomicWrite } from "@/lib/tracker/archive-job-store";
import { stateSchema, type PostState } from "./types";

export class PostsStore {
  readonly file: string;
  constructor(directory: string) { this.file = path.join(directory, "state.json"); }
  async load(): Promise<PostState> {
    try { return stateSchema.parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, cooldownUntil: 0, accounts: {} };
      throw new ApiError("Your saved tweets could not be read. The original file was preserved. Check storage before restarting.", 503);
    }
  }
  async save(state: PostState) { await atomicWrite(this.file, stateSchema.parse(state)); }
}
