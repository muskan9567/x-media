import { analyzeState } from "./analyzer";
import { DEMO_HANDLES, MockXProvider } from "./mock-provider";
import type {
  ProviderAccount,
  ProviderTweet,
  TrackerState,
  TrackedAccount,
  TrackedTweet,
  TweetMetrics,
} from "./types";

function scaledMetrics(metrics: TweetMetrics, ratio: number): TweetMetrics {
  return {
    likeCount: Math.round(metrics.likeCount * ratio),
    repostCount: Math.round(metrics.repostCount * ratio),
    replyCount: Math.round(metrics.replyCount * ratio),
    quoteCount: Math.round(metrics.quoteCount * ratio),
    bookmarkCount: Math.round(metrics.bookmarkCount * ratio),
    viewCount:
      metrics.viewCount === undefined
        ? undefined
        : Math.round(metrics.viewCount * ratio),
  };
}

function toTrackedAccount(
  account: ProviderAccount,
  index: number,
  now: Date,
): TrackedAccount {
  return {
    ...account,
    id: `account-${account.xUserId}`,
    active: true,
    manualNiches: [],
    inferredNiches: [],
    nicheConfidence: {},
    addedAt: new Date(
      now.getTime() - (index + 2) * 24 * 60 * 60 * 1_000,
    ).toISOString(),
    lastSyncedAt: now.toISOString(),
    syncStatus: "ready",
  };
}

function toTrackedTweet(
  tweet: ProviderTweet,
  account: TrackedAccount,
  now: Date,
  index: number,
): TrackedTweet {
  const createdAt = new Date(tweet.createdAt).getTime();
  const previousObservedAt = new Date(
    Math.max(createdAt + 15 * 60 * 1_000, now.getTime() - 50 * 60 * 1_000),
  ).toISOString();
  const ratio = 0.69 + (index % 4) * 0.065;

  return {
    ...tweet,
    accountId: account.id,
    authorUsername: account.username,
    authorDisplayName: account.displayName,
    authorProfileImageUrl: account.profileImageUrl,
    authorFollowersCount: account.followersCount,
    url: `https://x.com/${account.username}/status/${tweet.id}`,
    niches: [],
    snapshots: [
      {
        observedAt: previousObservedAt,
        metrics: scaledMetrics(tweet.metrics, ratio),
      },
      { observedAt: now.toISOString(), metrics: tweet.metrics },
    ],
    viralityScore: 0,
    replyScore: 0,
    confidence: 0,
    stage: "baseline",
    scoreReasons: [],
    replyReasons: [],
    riskFlags: [],
    workflowStatus: "new",
    firstSeenAt: previousObservedAt,
    lastSeenAt: now.toISOString(),
  };
}

export async function createSeedState(now = new Date()): Promise<TrackerState> {
  const provider = new MockXProvider(() => now.getTime());
  const accounts: TrackedAccount[] = [];
  const tweets: TrackedTweet[] = [];

  for (const [accountIndex, handle] of DEMO_HANDLES.entries()) {
    const providerAccount = await provider.resolveAccount(handle);
    const account = toTrackedAccount(providerAccount, accountIndex, now);
    const providerTweets = await provider.fetchRecentTweets(providerAccount);
    accounts.push(account);
    tweets.push(
      ...providerTweets.map((tweet, tweetIndex) =>
        toTrackedTweet(tweet, account, now, tweetIndex),
      ),
    );
  }

  return analyzeState(
    {
      version: 2,
      accounts,
      tweets,
      createdAt: now.toISOString(),
      lastSyncedAt: now.toISOString(),
    },
    now,
  );
}
