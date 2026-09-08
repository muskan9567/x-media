import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMeme, redditId } from "./normalize-meme.mjs";

const raw = { id: "abc123", title: "rawDogGithubCopilot", subreddit: "ProgrammerHumor", score: 500,
  link_flair_text: "Meme", url: "https://i.redd.it/abc.png", created_utc: 1788500000 };

test("collects direct image URLs without a post_hint and recognizes camel case topics end to end", () => {
  for (const title of ["rawDogGithubCopilot", "lifeBeforeChatgpt", "aiAlignmentIsGoingGreatGuys", "ClaudeCode"]) {
    const meme = normalizeMeme({ ...raw, title });
    assert.equal(meme.topicRelevant, true, title);
    assert.equal(meme.isMeme, true, title);
    assert.equal(meme.imageUrl, raw.url);
  }
  assert.equal(normalizeMeme({ ...raw, title: "onlyDevInTheFamilyWasAMistake" }).topicRelevant, false);
});

test("cache normalization discards obsolete keep/rank decisions and retains publication dates", () => {
  const meme = normalizeMeme({ ...raw, title: "I built an AI newsletter", created_utc: undefined, created: 1788500000,
    score: 10000, qualityScore: 999, heuristicScore: 999, isMeme: true, reviewStatus: "keep", tier: "S" });
  assert.equal(meme.created, 1788500000);
  assert.equal(meme.isMeme, false);
  assert.equal(meme.reviewStatus, undefined);
  assert.ok(meme.qualityScore <= 100);
});

test("does not turn removed, NSFW, or video thumbnails into shareable memes", () => {
  for (const extra of [{ over_18: true }, { removed_by_category: "moderator" }, { is_video: true }, { stickied: true }]) {
    assert.equal(normalizeMeme({ ...raw, ...extra }), null);
  }
});

test("extracts the Reddit post ID rather than the title slug", () => {
  assert.equal(redditId("https://www.reddit.com/r/ClaudeAI/comments/abc123/the_title/"), "abc123");
  assert.equal(redditId("https://redd.it/abc123"), "abc123");
  assert.equal(redditId("https://example.com/comments/abc123"), null);
});
