const TOPIC_PHRASES = [
  "claude", "anthropic", "deepseek", "chatgpt", "openai", "gpt",
  "gemini", "copilot", "grok", "llm", "large language model",
  "vibe coding", "vibecoding", "vibe coder", "cursor", "codex",
  "agentic", "ai agent", "coding agent", "mcp", "model context protocol",
  "windsurf", "devin", "replit agent", "prompt engineering",
  "promptengineering", "ai coding", "ai programmer", "coding assistant",
  "github copilot", "gemini cli", "cline", "roo code", "roocode",
  "continue dev", "continuedev", "langchain", "crew ai", "crewai",
  "autogen", "modelcontextprotocol", "multi agent", "agent workflow",
  "n8n", "replit", "lovable", "bolt new", "boltnewbuilders",
];

export function topicText(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function hasAiCodingTopic(value) {
  return matchingAiCodingTopics(value).length > 0;
}

const TOPIC_MATCHERS = TOPIC_PHRASES.map(phrase => [phrase,
  new RegExp(`\\b${topicText(phrase).split(' ').join('[\\s-]*')}(?:s|\\d+(?:\\.\\d+)*)?\\b`, 'i')]);

export function matchingAiCodingTopics(value) {
  const text = topicText(value);
  const matches = TOPIC_MATCHERS.filter(([phrase,pattern]) => {
    if (["lovable", "cursor", "devin", "cline"].includes(phrase)
      && text.trim() !== phrase
      && !/\b(ai|code|coding|coder|programming|agent|tool|ide|editor|app|builder|llm|copilot|codex)\b/.test(text)) return false;
    return pattern.test(text);
  }).map(([phrase]) => phrase);
  if (/\bai\b/.test(text)) matches.unshift("ai");
  return [...new Set(matches)];
}
