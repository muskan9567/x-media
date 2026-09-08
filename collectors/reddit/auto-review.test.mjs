import test from "node:test";
import assert from "node:assert/strict";
import { autoKeepFreshMemes } from "./auto-review.mjs";

test("only auto-keeps verified strong candidates and preserves rejections", () => {
  const reviews = { rejected: { verdict: "reject", at: "earlier" } };
  const strong = { isMeme: true, topicRelevant: true, imageUrl: "https://i.redd.it/a.png", assetVerified: true, assetQualityScore: 92, qualityScore: 85, score: 300, qualitySignals: ["meme-focused source: r/ProgrammerHumor"] };
  const kept = autoKeepFreshMemes([
    { ...strong, id: "fresh-s", tier: "S" },
    { ...strong, id: "fresh-a", tier: "A", qualityScore: 72 },
    { ...strong, id: "fresh-b", tier: "B" },
    { ...strong, id: "rejected", tier: "S" },
    { ...strong, id: "broken-image", tier: "S", assetVerified: false },
    { ...strong, id: "no-votes", tier: "S", score: null },
    { ...strong, id: "flair-only", tier: "S", qualityWarnings: ["meme flair is the only humor signal"] },
    { ...strong, id: "light-only", tier: "S", qualitySignals: ["humor wording"] },
  ], reviews, () => "2026-08-26T17:00:00.000Z");
  assert.deepEqual(kept, ["fresh-s", "fresh-a"]);
  assert.deepEqual(reviews["fresh-s"], { verdict: "keep", at: "2026-08-26T17:00:00.000Z", source: "automatic-quality-v3" });
  assert.equal(reviews["fresh-a"].verdict, "keep");
  assert.equal(reviews.rejected.verdict, "reject");
});
