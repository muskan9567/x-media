import test from "node:test";
import assert from "node:assert/strict";
import { isRecentMeme } from "./freshness.mjs";

test("accepts recent Reddit posts and rejects stale or undated posts", () => {
  const now = Date.parse("2026-08-26T18:00:00.000Z");
  assert.equal(isRecentMeme({ created: now / 1000 - 60 }, { now }), true);
  assert.equal(isRecentMeme({ created: now / 1000 - 47 * 3600 }, { now }), true);
  assert.equal(isRecentMeme({ created: now / 1000 - 49 * 3600 }, { now }), false);
  assert.equal(isRecentMeme({ created: null }, { now }), false);
});
