import { beforeAll, describe, expect, it } from "vitest";

import { createSeedState } from "./seed";
import { parseTrackerState } from "./state-schema";
import type { TrackerState } from "./types";

let validState: TrackerState;

beforeAll(async () => {
  validState = await createSeedState(new Date("2026-08-23T12:00:00.000Z"));
});

describe("trackerStateSchema", () => {
  it("accepts a complete valid state", () => {
    expect(parseTrackerState(validState)).toEqual(validState);
  });

  it("rejects duplicate immutable account identities", () => {
    const duplicate = structuredClone(validState);
    duplicate.accounts[1].id = duplicate.accounts[0].id;
    duplicate.accounts[1].xUserId = duplicate.accounts[0].xUserId;

    expect(() => parseTrackerState(duplicate)).toThrow(/duplicate/i);
  });

  it("rejects duplicate posts and orphaned account references", () => {
    const duplicate = structuredClone(validState);
    duplicate.tweets[1].id = duplicate.tweets[0].id;
    expect(() => parseTrackerState(duplicate)).toThrow(/duplicate post/i);

    const orphan = structuredClone(validState);
    orphan.tweets[0].accountId = "missing-account";
    expect(() => parseTrackerState(orphan)).toThrow(/unknown account/i);
  });

  it("rejects invalid nested enums, dates, counts, and future versions", () => {
    const invalid = structuredClone(validState) as unknown as {
      version: number;
      accounts: Array<Record<string, unknown>>;
      tweets: Array<Record<string, unknown>>;
    };
    invalid.version = 3;
    invalid.accounts[0].syncStatus = "stuck";
    invalid.tweets[0].createdAt = "yesterday";
    invalid.tweets[0].metrics = { likeCount: -1 };

    expect(() => parseTrackerState(invalid)).toThrow();
  });

  it("rejects unsupported reply restrictions", () => {
    const invalid = structuredClone(validState) as unknown as {
      tweets: Array<Record<string, unknown>>;
    };
    invalid.tweets[0].replySettings = "subscribers";

    expect(() => parseTrackerState(invalid)).toThrow(/replySettings/i);
  });

  it("rejects source mismatches between a post and its account", () => {
    const invalid = structuredClone(validState);
    invalid.tweets[0].source = "x";

    expect(() => parseTrackerState(invalid)).toThrow(/source must match/i);
  });
});
