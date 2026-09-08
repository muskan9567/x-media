import { normalizeMeme, redditId } from "./normalize-meme.mjs";

export function normalizeHotMeme(raw, { now = Date.now(), minUps = 25 } = {}) {
  const id = redditId(raw?.postLink);
  const ups = Number(raw?.ups);
  if (!id || raw?.nsfw || raw?.spoiler || !Number.isFinite(ups) || ups < minUps) return null;
  const meme = normalizeMeme({
    ...raw, id, score: ups, permalink: raw.postLink,
    // The hot API supplies no publication date. Discovery is not publication.
    created: raw.created_utc ?? raw.created ?? null,
    discoveredAt: new Date(now).toISOString(), discoverySource: "meme-api-hot",
  });
  return meme?.isMeme && meme.topicRelevant ? meme : null;
}