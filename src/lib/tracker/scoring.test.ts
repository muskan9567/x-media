import { describe, expect, it } from "vitest";

import {
  VIRAL_SCORE_THRESHOLD,
  hoursSince,
  scoreTweet,
  weightedEngagement,
} from "./scoring";
import type {
  MetricSnapshot,
  TrackedAccount,
  TrackedTweet,
  TweetMetrics,
} from "./types";

const NOW = new Date("2026-08-23T12:00:00.000Z");

function metrics(overrides: Partial<TweetMetrics> = {}): TweetMetrics {
  return {
    likeCount: 30,
    repostCount: 6,
    replyCount: 4,
    quoteCount: 2,
    bookmarkCount: 1,
    ...overrides,
  };
}

function account(overrides: Partial<TrackedAccount> = {}): TrackedAccount {
  return {
    id: "account-1",
    xUserId: "x-account-1",
    username: "signaltest",
    displayName: "Signal Test",
    bio: "AI and software",
    followersCount: 10_000,
    followingCount: 100,
    tweetCount: 500,
    verified: false,
    active: true,
    manualNiches: [],
    inferredNiches: ["AI & Tech"],
    nicheConfidence: { "AI & Tech": 90 },
    addedAt: NOW.toISOString(),
    syncStatus: "ready",
    ...overrides,
    source: overrides.source ?? "x",
  };
}

function tweet(
  id: string,
  overrides: Partial<TrackedTweet> = {},
): TrackedTweet {
  const createdAt = new Date(NOW.getTime() - 12 * 60 * 60 * 1_000).toISOString();
  const currentMetrics = overrides.metrics ?? metrics();
  return {
    id,
    accountId: "account-1",
    text: "A practical AI agent workflow for software teams.",
    createdAt,
    language: "en",
    conversationId: id,
    possiblySensitive: false,
    replySettings: "everyone",
    metrics: currentMetrics,
    authorUsername: "signaltest",
    authorDisplayName: "Signal Test",
    authorFollowersCount: 10_000,
    url: `https://x.com/signaltest/status/${id}`,
    niches: ["AI & Tech"],
    snapshots: [
      {
        observedAt: NOW.toISOString(),
        metrics: currentMetrics,
      },
    ],
    viralityScore: 0,
    replyScore: 0,
    confidence: 0,
    stage: "baseline",
    scoreReasons: [],
    replyReasons: [],
    riskFlags: [],
    workflowStatus: "new",
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    ...overrides,
    source: overrides.source ?? "x",
  };
}

function baselineTweets(
  accountId = "account-1",
  followersCount = 10_000,
): TrackedTweet[] {
  return [12, 25, 45, 80, 130, 210].map((likes, index) =>
    tweet(`baseline-${accountId}-${index}`, {
      accountId,
      authorFollowersCount: followersCount,
      createdAt: new Date(
        NOW.getTime() - 24 * 60 * 60 * 1_000,
      ).toISOString(),
      metrics: metrics({
        likeCount: likes,
        repostCount: index * 3,
        replyCount: 1 + index,
        quoteCount: index,
        bookmarkCount: index,
      }),
    }),
  );
}

function likesOnly(likeCount: number): TweetMetrics {
  return metrics({
    likeCount,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
    bookmarkCount: 0,
  });
}

function snapshots(...observations: TweetMetrics[]): MetricSnapshot[] {
  return observations.map((observationMetrics, index) => ({
    observedAt: new Date(
      NOW.getTime() - (observations.length - index - 1) * 60 * 60 * 1_000,
    ).toISOString(),
    metrics: observationMetrics,
  }));
}

describe("weightedEngagement", () => {
  it("weights high-intent interactions more than likes", () => {
    expect(
      weightedEngagement({
        likeCount: 100,
        repostCount: 10,
        quoteCount: 4,
        replyCount: 20,
        bookmarkCount: 8,
      }),
    ).toBeCloseTo(153.2);
  });
});

describe("hoursSince", () => {
  it("uses a quarter-hour floor and a safe fallback for invalid dates", () => {
    expect(hoursSince(NOW.toISOString(), NOW)).toBe(0.25);
    expect(hoursSince("not-a-date", NOW)).toBe(24);
  });
});

describe("scoreTweet", () => {
  it("ranks an engagement outlier above the author's robust baseline", () => {
    const trackedAccount = account();
    const baseline = baselineTweets();
    const ordinary = tweet("ordinary", { metrics: metrics({ likeCount: 32 }) });
    const outlier = tweet("outlier", {
      metrics: metrics({
        likeCount: 1_500,
        repostCount: 260,
        replyCount: 95,
        quoteCount: 70,
        bookmarkCount: 80,
      }),
    });

    const ordinaryScore = scoreTweet(
      ordinary,
      trackedAccount,
      [...baseline, ordinary, outlier],
      ["AI & Tech"],
      NOW,
    );
    const outlierScore = scoreTweet(
      outlier,
      trackedAccount,
      [...baseline, ordinary, outlier],
      ["AI & Tech"],
      NOW,
    );

    expect(outlierScore.viralityScore).toBeGreaterThan(
      ordinaryScore.viralityScore + 20,
    );
    expect(outlierScore.stage).toBe("viral");
    expect(outlierScore.scoreReasons.join(" ")).toMatch(/baseline|audience/i);
  });

  it("normalizes the same engagement against audience size", () => {
    const currentMetrics = metrics({
      likeCount: 300,
      repostCount: 45,
      replyCount: 20,
      quoteCount: 12,
      bookmarkCount: 10,
    });
    const smallAccount = account({ id: "small", followersCount: 2_000 });
    const largeAccount = account({ id: "large", followersCount: 200_000 });
    const smallTweet = tweet("small-post", {
      accountId: "small",
      authorFollowersCount: 2_000,
      metrics: currentMetrics,
    });
    const largeTweet = tweet("large-post", {
      accountId: "large",
      authorFollowersCount: 200_000,
      metrics: currentMetrics,
    });

    const cohort = [
      ...baselineTweets("small", 20_000),
      ...baselineTweets("large", 20_000),
    ];
    const smallScore = scoreTweet(
      smallTweet,
      smallAccount,
      cohort,
      ["AI & Tech"],
      NOW,
    );
    const largeScore = scoreTweet(
      largeTweet,
      largeAccount,
      cohort,
      ["AI & Tech"],
      NOW,
    );

    expect(smallScore.viralityScore).toBeGreaterThan(largeScore.viralityScore);
  });

  it("rewards freshness in the reply opportunity score", () => {
    const trackedAccount = account();
    const baseline = baselineTweets();
    const fresh = tweet("fresh", {
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString(),
    });
    const old = tweet("old", {
      createdAt: new Date(
        NOW.getTime() - 72 * 60 * 60 * 1_000,
      ).toISOString(),
    });

    const freshScore = scoreTweet(
      fresh,
      trackedAccount,
      [...baseline, fresh, old],
      ["AI & Tech"],
      NOW,
    );
    const oldScore = scoreTweet(
      old,
      trackedAccount,
      [...baseline, fresh, old],
      ["AI & Tech"],
      NOW,
    );

    expect(freshScore.replyScore).toBeGreaterThan(oldScore.replyScore + 10);
    expect(freshScore.replyReasons).toContain("Fresh enough to join early");
  });

  it("detects acceleration by comparing consecutive interval velocities", () => {
    const trackedAccount = account();
    const baseline = baselineTweets();
    const latest = likesOnly(100);
    const accelerating = tweet("accelerating", {
      metrics: latest,
      snapshots: snapshots(likesOnly(0), likesOnly(40), latest),
    });
    const flat = tweet("flat", {
      metrics: latest,
      snapshots: snapshots(likesOnly(0), likesOnly(50), latest),
    });

    const acceleratingScore = scoreTweet(
      accelerating,
      trackedAccount,
      [...baseline, accelerating, flat],
      ["AI & Tech"],
      NOW,
    );
    const flatScore = scoreTweet(
      flat,
      trackedAccount,
      [...baseline, accelerating, flat],
      ["AI & Tech"],
      NOW,
    );

    expect(acceleratingScore.viralityScore).toBeGreaterThan(
      flatScore.viralityScore,
    );
    expect(acceleratingScore.scoreReasons).toContain(
      "Momentum accelerated across the latest two intervals",
    );
    expect(flatScore.scoreReasons).toContain(
      "Momentum held steady across the latest two intervals",
    );
  });

  it("requires three observations before reporting acceleration", () => {
    const target = tweet("two-observations", {
      metrics: likesOnly(100),
      snapshots: snapshots(likesOnly(0), likesOnly(100)),
    });

    const result = scoreTweet(
      target,
      account(),
      [...baselineTweets(), target],
      ["AI & Tech"],
      NOW,
    );

    expect(result.scoreReasons).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/momentum/i)]),
    );
  });

  it("treats 0→100→150 growth as deceleration and steady velocity as flat", () => {
    const trackedAccount = account();
    const baseline = baselineTweets();
    const latest = likesOnly(150);
    const decelerating = tweet("decelerating", {
      metrics: latest,
      snapshots: snapshots(likesOnly(0), likesOnly(100), latest),
    });
    const flat = tweet("steady-velocity", {
      metrics: latest,
      snapshots: snapshots(likesOnly(0), likesOnly(75), latest),
    });
    const cohort = [...baseline, decelerating, flat];

    const deceleratingScore = scoreTweet(
      decelerating,
      trackedAccount,
      cohort,
      ["AI & Tech"],
      NOW,
    );
    const flatScore = scoreTweet(
      flat,
      trackedAccount,
      cohort,
      ["AI & Tech"],
      NOW,
    );

    expect(deceleratingScore.viralityScore).toBeLessThan(
      flatScore.viralityScore,
    );
    expect(deceleratingScore.scoreReasons).toContain(
      "Momentum decelerated across the latest two intervals",
    );
    expect(deceleratingScore.scoreReasons).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/accelerated/i)]),
    );
    expect(flatScore.scoreReasons).toContain(
      "Momentum held steady across the latest two intervals",
    );
  });

  it("detects outliers when every historical baseline value is identical", () => {
    const trackedAccount = account();
    const identicalBaseline = Array.from({ length: 6 }, (_, index) =>
      tweet(`identical-${index}`, {
        metrics: metrics({
          likeCount: 100,
          repostCount: 10,
          replyCount: 8,
          quoteCount: 4,
          bookmarkCount: 3,
        }),
      }),
    );
    const positiveOutlier = tweet("positive-outlier", {
      metrics: metrics({
        likeCount: 1_000,
        repostCount: 100,
        replyCount: 80,
        quoteCount: 40,
        bookmarkCount: 30,
      }),
    });
    const negativeOutlier = tweet("negative-outlier", {
      metrics: metrics({
        likeCount: 1,
        repostCount: 0,
        replyCount: 0,
        quoteCount: 0,
        bookmarkCount: 0,
      }),
    });

    const positive = scoreTweet(
      positiveOutlier,
      trackedAccount,
      [...identicalBaseline, positiveOutlier],
      ["AI & Tech"],
      NOW,
    );
    const negative = scoreTweet(
      negativeOutlier,
      trackedAccount,
      [...identicalBaseline, negativeOutlier],
      ["AI & Tech"],
      NOW,
    );

    expect(positive.viralityScore).toBeGreaterThanOrEqual(
      VIRAL_SCORE_THRESHOLD,
    );
    expect(positive.stage).toBe("viral");
    expect(negative.viralityScore).toBeLessThan(positive.viralityScore - 40);
    expect(negative.scoreReasons).toContain(
      "Engagement velocity is below the current baseline",
    );
  });

  it("compares older posts at the candidate post's age", () => {
    const targetMetrics = metrics({
      likeCount: 100,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      bookmarkCount: 0,
    });
    const target = tweet("one-hour-target", {
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString(),
      metrics: targetMetrics,
    });
    const historical = Array.from({ length: 5 }, (_, index) => {
      const createdAt = new Date(
        NOW.getTime() - 48 * 60 * 60 * 1_000,
      );
      return tweet(`historical-${index}`, {
        createdAt: createdAt.toISOString(),
        metrics: targetMetrics,
        snapshots: [
          {
            observedAt: new Date(
              createdAt.getTime() + 60 * 60 * 1_000,
            ).toISOString(),
            metrics: targetMetrics,
          },
          { observedAt: NOW.toISOString(), metrics: targetMetrics },
        ],
      });
    });

    const result = scoreTweet(
      target,
      account(),
      [...historical, target],
      ["AI & Tech"],
      NOW,
    );

    expect(result.viralityScore).toBeLessThan(VIRAL_SCORE_THRESHOLD);
    expect(result.scoreReasons).toContain(
      "Engagement velocity is near the current baseline",
    );
  });

  it("treats an unchanged last-seen metric sample as deceleration", () => {
    const trackedAccount = account();
    const baseline = baselineTweets();
    const earlierMetrics = likesOnly(0);
    const previousMetrics = metrics({
      likeCount: 10,
      repostCount: 1,
      replyCount: 1,
      quoteCount: 0,
      bookmarkCount: 0,
    });
    const latestMetrics = metrics({
      likeCount: 180,
      repostCount: 25,
      replyCount: 12,
      quoteCount: 8,
      bookmarkCount: 6,
    });
    const earlierObservedAt = new Date(
      NOW.getTime() - 4 * 60 * 60 * 1_000,
    ).toISOString();
    const previousObservedAt = new Date(
      NOW.getTime() - 3 * 60 * 60 * 1_000,
    ).toISOString();
    const latestObservedAt = new Date(
      NOW.getTime() - 2 * 60 * 60 * 1_000,
    ).toISOString();
    const historicalSnapshots: MetricSnapshot[] = [
      { observedAt: earlierObservedAt, metrics: earlierMetrics },
      { observedAt: previousObservedAt, metrics: previousMetrics },
      { observedAt: latestObservedAt, metrics: latestMetrics },
    ];
    const accelerating = tweet("recently-accelerating", {
      metrics: latestMetrics,
      snapshots: historicalSnapshots,
      lastSeenAt: latestObservedAt,
    });
    const nowFlat = tweet("now-flat", {
      metrics: latestMetrics,
      snapshots: historicalSnapshots,
      lastSeenAt: NOW.toISOString(),
    });
    const cohort = [...baseline, accelerating, nowFlat];

    const acceleratingResult = scoreTweet(
      accelerating,
      trackedAccount,
      cohort,
      ["AI & Tech"],
      NOW,
    );
    const flatResult = scoreTweet(
      nowFlat,
      trackedAccount,
      cohort,
      ["AI & Tech"],
      NOW,
    );

    expect(acceleratingResult.scoreReasons).toContain(
      "Momentum accelerated across the latest two intervals",
    );
    expect(flatResult.scoreReasons).toContain(
      "Momentum decelerated across the latest two intervals",
    );
    expect(flatResult.scoreReasons).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/accelerated/i)]),
    );
    expect(acceleratingResult.viralityScore).toBeGreaterThan(
      flatResult.viralityScore,
    );
  });

  it("keeps sparse-author scoring invariant to foreign-author history", () => {
    const target = tweet("new-author-post", {
      metrics: likesOnly(500),
    });
    const sparseHistory = [10, 20, 30].map((likes, index) =>
      tweet(`same-author-${index}`, { metrics: likesOnly(likes) }),
    );
    const otherAuthors = [1, 5, 50, 500, 5_000, 50_000].map(
      (likes, index) =>
        tweet(`other-${index}`, {
          accountId: `other-account-${index}`,
          authorUsername: `other${index}`,
          authorFollowersCount: 500 * 10 ** index,
          metrics: likesOnly(likes),
        }),
    );

    const authorOnlyResult = scoreTweet(
      target,
      account(),
      [target, ...sparseHistory],
      ["AI & Tech"],
      NOW,
    );
    const foreignHistoryResult = scoreTweet(
      target,
      account(),
      [target, ...sparseHistory, ...otherAuthors],
      ["AI & Tech"],
      NOW,
    );

    expect(foreignHistoryResult).toEqual(authorOnlyResult);
    expect(authorOnlyResult.confidence).toBe(48);
    expect(authorOnlyResult.scoreReasons).toContain(
      "Engagement velocity is near the current baseline",
    );
  });

  it("suppresses reply opportunities when X limits or omits reply eligibility", () => {
    const open = tweet("open-replies", { replySettings: "everyone" });
    const restricted = tweet("restricted-replies", {
      replySettings: "mentionedUsers",
    });
    const followingOnly = tweet("following-replies", {
      replySettings: "following",
    });
    const unknown = tweet("unknown-replies", { replySettings: undefined });
    const mock = tweet("mock-replies", {
      source: "mock",
      replySettings: undefined,
    });
    const cohort = [
      ...baselineTweets(),
      open,
      restricted,
      followingOnly,
      unknown,
      mock,
    ];

    const openResult = scoreTweet(open, account(), cohort, ["AI & Tech"], NOW);
    const restrictedResult = scoreTweet(
      restricted,
      account(),
      cohort,
      ["AI & Tech"],
      NOW,
    );
    const followingOnlyResult = scoreTweet(
      followingOnly,
      account(),
      cohort,
      ["AI & Tech"],
      NOW,
    );
    const unknownResult = scoreTweet(
      unknown,
      account(),
      cohort,
      ["AI & Tech"],
      NOW,
    );
    const mockResult = scoreTweet(mock, account(), cohort, ["AI & Tech"], NOW);

    expect(restrictedResult.riskFlags).toContain(
      "Replies are limited to mentioned accounts",
    );
    expect(followingOnlyResult.riskFlags).toContain(
      "Replies are limited to accounts the author follows",
    );
    expect(unknownResult.riskFlags).toContain(
      "Reply eligibility was not provided by X",
    );
    expect(restrictedResult.replyScore).toBeLessThan(openResult.replyScore);
    expect(unknownResult.replyScore).toBeLessThan(openResult.replyScore);
    expect(restrictedResult.replyReasons).not.toContain(
      "Active, open conversation pattern",
    );
    expect(mockResult.riskFlags).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/repl(?:y|ies)/i)]),
    );
  });

  it("flags sensitive, promotional, link-heavy, and uppercase posts", () => {
    const risky = tweet("risky", {
      possiblySensitive: true,
      text: "URGENT GIVEAWAY FREE MONEY DM ME THIS OFFER WILL CHANGE EVERYTHING FOR EVERYONE TODAY NOW NOW NOW https://a.co https://b.co https://c.co",
    });
    const result = scoreTweet(
      risky,
      account(),
      [...baselineTweets(), risky],
      ["AI & Tech"],
      NOW,
    );

    expect(result.riskFlags).toEqual(
      expect.arrayContaining([
        "Sensitive-content flag",
        "Promotional or spam-like language",
        "Link-heavy post",
        "Mostly uppercase text",
      ]),
    );
  });
});
