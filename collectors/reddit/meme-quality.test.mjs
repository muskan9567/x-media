import test from "node:test";
import assert from "node:assert/strict";
import { compareMemes, evaluateMeme } from "./meme-quality.mjs";

const candidate = (title, extra = {}) => ({
  id: title,
  title,
  subreddit: "ClaudeAI",
  score: 120,
  images: ["https://i.redd.it/example.png"],
  ...extra,
});

test("accepts recognizable AI meme formats", () => {
  const examples = [
    candidate("claudeCodeCardio", { subreddit: "ProgrammerHumor" }),
    candidate("lifeBeforeChatgpt", { subreddit: "ProgrammerHumor", score: 1282 }),
    candidate("Literally everyone while using Claude"),
    candidate("When you realize Grok is drowning while Claude Code gets all the attention"),
    candidate("POV: my code standing on Claude, GitHub Copilot, coffee, and late nights"),
  ];

  for (const post of examples) {
    assert.equal(evaluateMeme(post).isMeme, true, post.title);
  }
});

test("accepts image posts from trusted general meme communities", () => {
  for (const subreddit of ["memes", "dankmemes", "me_irl", "HistoryMemes", "PrequelMemes"]) {
    assert.equal(evaluateMeme(candidate("When you finally find a completely new meme", { subreddit, score: 1 })).isMeme, true, subreddit);
  }
});

test("rejects high-engagement AI content that is not a meme", () => {
  const examples = [
    candidate("GPT 5.6 Sol Max leads on ClockBench", { subreddit: "singularity", score: 4200 }),
    candidate("DeepSeek V4 Flash benchmarks and pricing announced", { subreddit: "DeepSeek", score: 1800 }),
    candidate("Best strategy and skills for Claude Code on a large project", { score: 900 }),
    candidate("I built an AI tool that analyzes text messages", { subreddit: "ChatGPT", score: 2500 }),
    candidate("We made an open-source kit for DeepSeek memes", { subreddit: "DeepSeek", score: 1200, flair: "Meme" }),
    candidate("I told my GPT to stop saying wrinkle and it made a funny joke", { subreddit: "ChatGPT", flair: "Funny" }),
    candidate("Claude + Blender. Impressive", { score: 600 }),
  ];

  for (const post of examples) {
    assert.equal(evaluateMeme(post).isMeme, false, post.title);
  }
});

test("rejects weakly meme-adjacent posts from the live feed", () => {
  const examples = [
    candidate("Claude + Blender. Impressive", { score: null, flair: "Meme" }),
    candidate("Used DeepSeek to set up DeepSeek Harness :)", { subreddit: "DeepSeek", score: 18, flair: "Meme" }),
    candidate("Realtime GPT RAM stuff", { subreddit: "ChatGPT", score: null, flair: "Meme" }),
  ];

  for (const post of examples) {
    assert.equal(evaluateMeme(post).isMeme, false, post.title);
  }
});

test("quality ranking beats raw upvotes", () => {
  const meme = { ...candidate("When you ask Claude to fix one tiny bug", { score: 80 }), ...evaluateMeme(candidate("When you ask Claude to fix one tiny bug", { score: 80 })) };
  const announcement = { ...candidate("New Claude model benchmark released", { score: 9000 }), ...evaluateMeme(candidate("New Claude model benchmark released", { score: 9000 })) };
  assert.ok(compareMemes(meme, announcement) < 0);
});

test("tier thresholds separate keepers, solid memes, and usable memes", () => {
  const keeper = candidate("lifeBeforeChatgpt", { subreddit: "ProgrammerHumor", score: 1282, flair: "Meme" });
  const solid = candidate("Vibe coding", { subreddit: "ProgrammerHumor", score: 1000 });
  const usable = candidate("When you ask Claude for one tiny refactor", { score: 120 });

  assert.equal(evaluateMeme(keeper).tier, "S");
  assert.equal(evaluateMeme(solid).tier, "A");
  assert.equal(evaluateMeme(usable).tier, "B");
  assert.equal(evaluateMeme(usable).isMeme, true);
});

test("does not mistake Reddit preview variants for a gallery", () => {
  const post = candidate("Cutting edge AI safety tests be like", {
    score: 120,
    flair: "Funny",
    images: ["https://i.redd.it/meme.png", "https://preview.redd.it/meme.png"],
    isGallery: false,
  });
  const result = evaluateMeme(post);
  const galleryResult = evaluateMeme({ ...post, isGallery: true });
  assert.equal(result.qualityScore, galleryResult.qualityScore + 10);
  assert.equal(result.qualityWarnings.includes("gallery posts are usually showcases, not single memes"), false);
});

test("unproven captions never get an S tier just from flair", () => {
  for (const score of [null, 1, 24]) {
    const result = evaluateMeme(candidate("When Claude writes code be like", { subreddit: "ProgrammerHumor", flair: "Meme", score }));
    assert.equal(result.tier, "B");
  }
});

test("model comparisons without humor are not reaction memes", () => {
  const result = evaluateMeme(candidate("GPT 5.6 vs Claude 5.1", { score: 50000, subreddit: "OpenAI" }));
  assert.equal(result.isMeme, false);
});
