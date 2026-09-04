import { describe, expect, it } from "vitest";

import { MockXProvider } from "./mock-provider";
import { createSeedState } from "./seed";

describe("MockXProvider", () => {
  it("uses collision-free account identities and preserves legacy IDs on refresh", async () => {
    const provider = new MockXProvider();
    const first = await provider.resolveAccount("t1_l1dy_ncb8ufa");
    const second = await provider.resolveAccount("67iym7oj6");

    expect(first.xUserId).toBe("mock-user-t1_l1dy_ncb8ufa");
    expect(second.xUserId).toBe("mock-user-67iym7oj6");
    expect(second.xUserId).not.toBe(first.xUserId);
    await expect(
      provider.refreshAccount({ ...first, xUserId: "mock-3105619529" }),
    ).resolves.toMatchObject({
      xUserId: "mock-3105619529",
      username: "t1_l1dy_ncb8ufa",
    });
  });

  it("keeps post identity and creation time stable within a UTC day", async () => {
    let currentTime = Date.parse("2026-08-23T01:15:00.000Z");
    const provider = new MockXProvider(() => currentTime);
    const account = await provider.resolveAccount("buildwithmaya");
    const first = await provider.fetchRecentTweets(account);

    currentTime = Date.parse("2026-08-23T22:45:00.000Z");
    const second = await provider.fetchRecentTweets(account);

    expect(second.map((post) => post.id)).toEqual(
      first.map((post) => post.id),
    );
    expect(second.map((post) => post.createdAt)).toEqual(
      first.map((post) => post.createdAt),
    );
    expect(second.every((post) => post.replySettings === "everyone")).toBe(true);
    expect(second[0].metrics.likeCount).toBeGreaterThanOrEqual(
      first[0].metrics.likeCount,
    );
  });

  it("starts a new stable post batch at the next UTC day", async () => {
    let currentTime = Date.parse("2026-08-23T23:59:00.000Z");
    const provider = new MockXProvider(() => currentTime);
    const account = await provider.resolveAccount("growthnotes");
    const first = await provider.fetchRecentTweets(account);

    currentTime = Date.parse("2026-08-24T00:01:00.000Z");
    const second = await provider.fetchRecentTweets(account);

    expect(second.map((post) => post.id)).not.toEqual(
      first.map((post) => post.id),
    );
    expect(second[0].createdAt).toBe("2026-08-23T22:54:00.000Z");
  });

  it("builds deterministic seed state from the supplied time", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");

    const first = await createSeedState(now);
    const second = await createSeedState(now);

    expect(second).toEqual(first);
    expect(first.tweets.every((post) => post.createdAt <= post.firstSeenAt)).toBe(
      true,
    );
  });
});
