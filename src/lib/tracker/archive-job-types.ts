import { z } from "zod";
import type { MediaArchiveResult } from "./media-archive";

export const usernameSchema = z.string().trim().transform((s) => s.replace(/^@/, "").toLowerCase()).pipe(z.string().regex(/^[a-z0-9_]{1,15}$/));
export const jobIdSchema = z.string().uuid();
export const mediaUrlSchema = z.string().url().refine((value) => {
  const u = new URL(value);
  return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") &&
    (u.hostname === "pbs.twimg.com" || u.hostname === "video.twimg.com");
}, "Unexpected media host");
export const archiveItemSchema = z.object({
  id: z.string(), postId: z.string().regex(/^\d+$/),
  postUrl: z.string().url().refine((s) => /^https:\/\/(?:x|twitter)\.com\/[a-zA-Z0-9_]+\/status\/\d+$/.test(s)),
  postText: z.string(), createdAt: z.string().datetime(),
  media: z.object({
    mediaKey: z.string(), type: z.enum(["photo", "video", "animated_gif"]),
    url: mediaUrlSchema.optional(), previewImageUrl: mediaUrlSchema.optional(),
    altText: z.string().optional(), width: z.number().optional(), height: z.number().optional(), durationMs: z.number().optional(),
    variants: z.array(z.object({ url: mediaUrlSchema, contentType: z.string().optional(), bitRate: z.number().optional() })),
  }),
});
export const accountSchema = z.object({
  username: usernameSchema, displayName: z.string(), profileImageUrl: mediaUrlSchema.optional(),
  items: z.array(archiveItemSchema), postsScanned: z.number().int().nonnegative(),
  batchesRead: z.number().int().nonnegative(), collectedAt: z.string().datetime().optional(),
});
export const checkpointSchema = z.object({
  provider: z.enum(["guest", "fxtwitter"]).optional(),
  username: usernameSchema, userId: z.string().regex(/^\d+$/), displayName: z.string(), profileImageUrl: mediaUrlSchema.optional(),
  cursor: z.string().min(1).max(8192), seenPostIds: z.array(z.string().regex(/^\d+$/)).max(10000),
  batchesRead: z.number().int().nonnegative(),
});
export type ArchiveCheckpoint = z.infer<typeof checkpointSchema>;
export const jobSchema = z.object({
  id: jobIdSchema, username: usernameSchema,
  status: z.enum(["queued", "running", "waiting", "partial", "unavailable", "cancelled", "failed"]),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  retries: z.number().int().min(0).max(3), retryAt: z.number().optional(),
  postsScanned: z.number().int().nonnegative(), batchesRead: z.number().int().nonnegative(),
  newItems: z.number().int().nonnegative(), message: z.string(),
  checkpoint: checkpointSchema.optional(),
});
export const stateSchema = z.object({
  version: z.literal(1), cooldownUntil: z.number(),
  accounts: z.record(z.string(), accountSchema), jobs: z.record(z.string(), jobSchema),
});
export const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("profile"), username: usernameSchema, displayName: z.string(), profileImageUrl: mediaUrlSchema.optional() }),
  z.object({ type: z.literal("batch"), items: z.array(archiveItemSchema), postsScanned: z.number().int().nonnegative(), batchesRead: z.number().int().nonnegative() }),
  z.object({ type: z.literal("checkpoint"), checkpoint: checkpointSchema }),
  z.object({ type: z.literal("done"), reason: z.enum(["exhausted", "limit", "repeated", "rate_limit", "timeout", "upstream", "unavailable", "yield"]), retryAt: z.number().optional() }),
]);
export type ArchiveAccount = z.infer<typeof accountSchema>;
export type ArchiveJob = z.infer<typeof jobSchema>;
export type ArchiveState = z.infer<typeof stateSchema>;
export type ArchiveEvent = z.infer<typeof eventSchema>;
export interface ArchiveJobView {
  job: ArchiveJob;
  result: MediaArchiveResult;
  collectedAt?: string;
  source: "live" | "saved";
}
export function isActiveJob(job: ArchiveJob): boolean {
  return ["queued", "running", "waiting"].includes(job.status);
}
export function emptyAccount(username: string): ArchiveAccount {
  return { username, displayName: username, items: [], postsScanned: 0, batchesRead: 0 };
}
export function mergeItems(previous: ArchiveAccount["items"], incoming: ArchiveAccount["items"]): ArchiveAccount["items"] {
  const items = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) {
    const old = items.get(item.id);
    items.set(item.id, old ? { ...old, ...item, media: { ...old.media, ...item.media,
      variants: item.media.variants.length ? item.media.variants : old.media.variants } } : item);
  }
  return [...items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
