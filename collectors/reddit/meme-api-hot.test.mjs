import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHotMeme } from "./meme-api-hot.mjs";

test("accepts only SFW high-engagement image memes from the hot fallback", () => {
  const base = { postLink: "https://redd.it/abc123", subreddit: "ProgrammerHumor", title: "Claude coding agent be like", url: "https://i.redd.it/abc123.png", ups: 2_500, nsfw: false, spoiler: false };
  const meme = normalizeHotMeme(base, { now: Date.parse("2026-08-26T18:00:00.000Z") });
  assert.equal(meme.id, "abc123");
  assert.equal(meme.tier, "S");
  assert.ok(meme.qualityScore <= 100);
  assert.equal(meme.created, null);
  assert.equal(meme.discoveredAt, "2026-08-26T18:00:00.000Z");
  assert.equal(normalizeHotMeme({ ...base, ups: 24 }), null);
  assert.equal(normalizeHotMeme({ ...base, nsfw: true }), null);
  assert.equal(normalizeHotMeme({ ...base, url: "https://v.redd.it/video" }), null);
  assert.equal(normalizeHotMeme({ ...base, title: "A popular but unrelated meme" }), null);
  assert.equal(normalizeHotMeme({ ...base, title: "I built an AI newsletter", ups: 50000 }), null);
  assert.equal(normalizeHotMeme({ ...base, title: "New GPT model benchmark released", ups: 50000 }), null);
  assert.equal(normalizeHotMeme({ ...base, postLink: "https://www.reddit.com/r/ProgrammerHumor/comments/abc123/claude_agent/" }).id, "abc123");
});
