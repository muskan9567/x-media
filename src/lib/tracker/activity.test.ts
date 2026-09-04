import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildActivity } from "./activity";
import type { TrackedTweet } from "./types";

const originalTimeZone = process.env.TZ;

function tweet(
  id: string,
  createdAt: string,
  likeCount: number,
): TrackedTweet {
  return {
    source: "x",
    id,
    accountId: "account-1",
    text: "Test post",
    createdAt,
    language: "en",
    conversationId: id,
    possiblySensitive: false,
    metrics: {
      likeCount,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      bookmarkCount: 0,
    },
    authorUsername: "signaltest",
    authorDisplayName: "Signal Test",
    authorFollowersCount: 1_000,
    url: `https://x.com/signaltest/status/${id}`,
    niches: ["AI & Tech"],
    snapshots: [],
    viralityScore: 50,
    replyScore: 70,
    confidence: 80,
    stage: "baseline",
    scoreReasons: [],
    replyReasons: [],
    riskFlags: [],
    workflowStatus: "new",
    firstSeenAt: createdAt,
    lastSeenAt: createdAt,
  };
}

describe("buildActivity", () => {
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });

  afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it("uses non-overlapping calendar days across spring-forward", () => {
    const activity = buildActivity(
      [
        tweet("march-8", "2026-03-08T23:30:00-04:00", 10),
        tweet("march-9", "2026-03-09T00:30:00-04:00", 20),
        tweet("midnight", "2026-03-09T00:00:00-04:00", 30),
      ],
      new Date("2026-03-09T12:00:00-04:00"),
    );

    expect(activity).toHaveLength(7);
    expect(activity.map((point) => point.date)).toEqual([
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
    expect(activity.find((point) => point.date === "2026-03-08")).toMatchObject(
      { engagement: 10, opportunities: 1 },
    );
    expect(activity.find((point) => point.date === "2026-03-09")).toMatchObject(
      { engagement: 50, opportunities: 2 },
    );
    expect(
      activity.reduce((sum, point) => sum + point.opportunities, 0),
    ).toBe(3);
  });

  it("includes the final fall-back hour in its calendar day", () => {
    const activity = buildActivity(
      [tweet("late-november-1", "2026-11-01T23:30:00-05:00", 40)],
      new Date("2026-11-02T12:00:00-05:00"),
    );

    expect(activity.find((point) => point.date === "2026-11-01")).toMatchObject(
      { engagement: 40, opportunities: 1 },
    );
    expect(
      activity.reduce((sum, point) => sum + point.opportunities, 0),
    ).toBe(1);
  });

  it("builds 24 rolling hourly buckets for the 24-hour range", () => {
    const activity = buildActivity(
      [
        tweet("first-hour", "2026-08-29T12:45:00-04:00", 10),
        tweet("last-hour", "2026-08-30T12:15:00-04:00", 20),
        tweet("too-old", "2026-08-29T12:29:00-04:00", 40),
      ],
      new Date("2026-08-30T12:30:00-04:00"),
      "24h",
    );

    expect(activity).toHaveLength(24);
    expect(activity.reduce((sum, point) => sum + point.engagement, 0)).toBe(30);
    expect(
      activity.reduce((sum, point) => sum + point.opportunities, 0),
    ).toBe(2);
  });

  it("builds thirty daily buckets for the 30-day range", () => {
    const activity = buildActivity(
      [
        tweet("first-day", "2026-08-01T08:00:00-04:00", 10),
        tweet("last-day", "2026-08-30T08:00:00-04:00", 20),
      ],
      new Date("2026-08-30T12:00:00-04:00"),
      "30d",
    );

    expect(activity).toHaveLength(30);
    expect(activity[0]).toMatchObject({
      date: "2026-08-01",
      engagement: 10,
      opportunities: 1,
    });
    expect(activity.at(-1)).toMatchObject({
      date: "2026-08-30",
      engagement: 20,
      opportunities: 1,
    });
  });

  it("covers all retained days when the retained span is short", () => {
    const activity = buildActivity(
      [tweet("retained-start", "2026-08-21T08:00:00-04:00", 15)],
      new Date("2026-08-30T12:00:00-04:00"),
      "all",
    );

    expect(activity).toHaveLength(10);
    expect(activity[0]).toMatchObject({
      date: "2026-08-21",
      engagement: 15,
      opportunities: 1,
    });
    expect(activity.at(-1)?.date).toBe("2026-08-30");
  });

  it("coarsens long all-retained spans without losing activity", () => {
    const activity = buildActivity(
      [
        tweet("old", "2024-01-15T08:00:00-05:00", 10),
        tweet("recent", "2026-08-30T08:00:00-04:00", 20),
      ],
      new Date("2026-08-30T12:00:00-04:00"),
      "all",
    );

    expect(activity.length).toBeLessThanOrEqual(36);
    expect(activity.reduce((sum, point) => sum + point.engagement, 0)).toBe(30);
    expect(
      activity.reduce((sum, point) => sum + point.opportunities, 0),
    ).toBe(2);
  });
});
