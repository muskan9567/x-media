import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "@/lib/api-response";
import { atomicWrite } from "@/lib/tracker/archive-job-store";

export const tokenSchema = z.string().trim().min(20).max(4096).regex(/^[A-Za-z0-9%._~+\/=\-]+$/, "Enter the bearer token from your X developer app.");
export class PostsConnection {
  readonly file: string;
  constructor(directory: string, private environmentToken = () => process.env.X_POSTS_BEARER_TOKEN) { this.file = path.join(directory, "connection.json"); }
  async token(): Promise<string | undefined> {
    try {
      const value = z.object({ token: tokenSchema }).parse(JSON.parse(await readFile(this.file, "utf8")));
      return value.token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ApiError("The X API connection could not be read. Save a replacement token below.", 503);
    }
    const token = this.environmentToken()?.trim();
    return token ? tokenSchema.parse(token) : undefined;
  }
  async status() { return { configured: !!await this.token(), source: "full_archive" as const }; }
  async save(input: unknown) { await atomicWrite(this.file, { token: tokenSchema.parse(input) }); return this.status(); }
}
export const postsConnection = new PostsConnection(path.join(process.cwd(), ".data", "posts"));
