import test from "node:test";
import assert from "node:assert/strict";
import { hasAiCodingTopic } from "./topic-filter.mjs";

test("recognizes AI coding topics without matching unrelated words", () => {
  for (const value of [
    "vibeCodingBeLike", "Claude coding agent", "Cursor vs Codex",
    "MCP tools", "AI agents in production", "ChatGPT wrote my tests",
    "AI_Agents", "PromptEngineering", "ClaudeCode",
  ]) assert.equal(hasAiCodingTopic(value), true, value);

  for (const value of [
    "childhoodDeveloperArc", "Wait, that's illegal", "said the engineer",
    "regular programming meme", "Indie games are the best",
    "onlyDevInTheFamilyWasAMistake", "aLovableDog", "onTheCline", "devInsideTheOffice",
  ]) assert.equal(hasAiCodingTopic(value), false, value);
});
