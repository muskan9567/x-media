import { z } from "zod";

import type { TrackerState } from "./types";

const timestampSchema = z.string().datetime({ offset: true });
const countSchema = z.number().finite().int().nonnegative();
const scoreSchema = z.number().finite().int().min(0).max(100);
const providerModeSchema = z.enum(["mock", "x"]);
const metricsSchema = z
  .object({
    likeCount: countSchema,
    repostCount: countSchema,
    replyCount: countSchema,
    quoteCount: countSchema,
    bookmarkCount: countSchema,
    viewCount: countSchema.optional(),
  })
  .strict();

const snapshotSchema = z
  .object({
    observedAt: timestampSchema,
    metrics: metricsSchema,
  })
  .strict();

const mediaVariantSchema = z
  .object({
    url: z.string().url(),
    contentType: z.string().min(1).optional(),
    bitRate: countSchema.optional(),
  })
  .strict();

const mediaSchema = z
  .object({
    mediaKey: z.string().min(1),
    type: z.enum(["photo", "video", "animated_gif"]),
    url: z.string().url().optional(),
    previewImageUrl: z.string().url().optional(),
    altText: z.string().optional(),
    width: countSchema.positive().optional(),
    height: countSchema.positive().optional(),
    durationMs: countSchema.optional(),
    variants: z.array(mediaVariantSchema).max(20),
  })
  .strict();

const accountSchema = z
  .object({
    source: providerModeSchema,
    xUserId: z.string().min(1),
    username: z.string().regex(/^[a-z0-9_]{1,15}$/),
    displayName: z.string().min(1),
    bio: z.string(),
    profileImageUrl: z.string().url().optional(),
    followersCount: countSchema,
    followingCount: countSchema,
    tweetCount: countSchema,
    verified: z.boolean(),
    id: z.string().min(1),
    active: z.boolean(),
    manualNiches: z.array(z.string().min(2).max(36)).max(6),
    inferredNiches: z.array(z.string().min(1).max(80)),
    nicheConfidence: z.record(z.string(), scoreSchema),
    addedAt: timestampSchema,
    lastSyncedAt: timestampSchema.optional(),
    syncStatus: z.enum(["ready", "syncing", "error"]),
    syncError: z.string().min(1).optional(),
  })
  .strict();

const tweetSchema = z
  .object({
    source: providerModeSchema,
    id: z.string().min(1),
    text: z.string(),
    createdAt: timestampSchema,
    language: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
    possiblySensitive: z.boolean().optional(),
    replySettings: z
      .enum(["everyone", "mentionedUsers", "following"])
      .optional(),
    media: z.array(mediaSchema).max(10).optional(),
    metrics: metricsSchema,
    accountId: z.string().min(1),
    authorUsername: z.string().min(1),
    authorDisplayName: z.string().min(1),
    authorProfileImageUrl: z.string().url().optional(),
    authorFollowersCount: countSchema,
    url: z.string().url(),
    niches: z.array(z.string().min(1).max(80)),
    snapshots: z.array(snapshotSchema).max(24),
    viralityScore: scoreSchema,
    replyScore: scoreSchema,
    confidence: scoreSchema,
    stage: z.enum(["baseline", "emerging", "rising", "viral", "cooling"]),
    scoreReasons: z.array(z.string()),
    replyReasons: z.array(z.string()),
    riskFlags: z.array(z.string()),
    workflowStatus: z.enum(["new", "saved", "responded", "dismissed"]),
    firstSeenAt: timestampSchema,
    lastSeenAt: timestampSchema,
  })
  .strict();

export const trackerStateSchema: z.ZodType<TrackerState> = z
  .object({
    version: z.literal(2),
    accounts: z.array(accountSchema),
    tweets: z.array(tweetSchema),
    createdAt: timestampSchema,
    lastSyncedAt: timestampSchema.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const accountIds = new Set<string>();
    const xUserIds = new Set<string>();
    const usernames = new Set<string>();

    state.accounts.forEach((account, index) => {
      if (accountIds.has(account.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate account id: ${account.id}`,
          path: ["accounts", index, "id"],
        });
      }
      if (xUserIds.has(account.xUserId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate X user id: ${account.xUserId}`,
          path: ["accounts", index, "xUserId"],
        });
      }
      const username = account.username.toLowerCase();
      if (usernames.has(username)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate username: ${account.username}`,
          path: ["accounts", index, "username"],
        });
      }
      accountIds.add(account.id);
      xUserIds.add(account.xUserId);
      usernames.add(username);
    });

    const tweetIds = new Set<string>();
    state.tweets.forEach((tweet, index) => {
      if (tweetIds.has(tweet.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate post id: ${tweet.id}`,
          path: ["tweets", index, "id"],
        });
      }
      tweetIds.add(tweet.id);

      const account = state.accounts.find(
        (candidate) => candidate.id === tweet.accountId,
      );
      if (!account) {
        context.addIssue({
          code: "custom",
          message: `Post references unknown account: ${tweet.accountId}`,
          path: ["tweets", index, "accountId"],
        });
      } else if (tweet.source !== account.source) {
        context.addIssue({
          code: "custom",
          message: "Post source must match its tracked account source.",
          path: ["tweets", index, "source"],
        });
      }
    });
  });

export function parseTrackerState(value: unknown): TrackerState {
  return trackerStateSchema.parse(value);
}
