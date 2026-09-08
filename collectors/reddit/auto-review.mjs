export function canAutoKeep(meme) {
  return Boolean(meme?.isMeme && meme.topicRelevant && meme.imageUrl
    && meme.assetVerified && meme.assetQualityScore >= 80
    && meme.qualityScore >= 70 && meme.score >= 25
    && ["S", "A"].includes(meme.tier)
    && (meme.qualitySignals || []).some(signal => /meme-focused source|strong meme phrasing|reaction\/punchline/.test(signal))
    && !(meme.qualityWarnings || []).some(warning =>
      /only humor signal|raw chatbot|self-promotion|low community|gallery|no meme/.test(warning)));
}

export function autoKeepFreshMemes(candidates, reviews, now = () => new Date().toISOString()) {
  const keptIds = [];
  for (const meme of candidates || []) {
    if (!meme?.id || reviews[meme.id] || !canAutoKeep(meme)) continue;
    reviews[meme.id] = { verdict: "keep", at: now(), source: "automatic-quality-v3" };
    keptIds.push(meme.id);
  }
  return keptIds;
}
