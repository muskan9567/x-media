export const DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function isRecentMeme(meme, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const raw = Number(meme?.created);
  if (!Number.isFinite(raw) || raw <= 0) return false;
  const createdAt = raw > 10_000_000_000 ? raw : raw * 1000;
  const age = now - createdAt;
  return age >= -5 * 60_000 && age <= maxAgeMs;
}
