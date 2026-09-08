import "server-only";
import path from "node:path";
import { PostsManager } from "./manager";
import { PostsStore } from "./store";
import { createPostsSource } from "./source";

// The app's archive lock (acquired in instrumentation) owns the single server.
const shared = globalThis as typeof globalThis & { xMediaPostsService?: Promise<PostsManager> };
export function getPostsService() {
  shared.xMediaPostsService ??= (async () => {
    // This surface never reads credentials or calls a billable X endpoint.
    const service = new PostsManager(new PostsStore(path.join(process.cwd(), ".data", "posts")), createPostsSource());
    await service.init(); return service;
  })();
  return shared.xMediaPostsService;
}
