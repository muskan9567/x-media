import { evaluateMeme, applyAssetAssessment } from "./meme-quality.mjs";

export function redditId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "redd.it") return url.pathname.match(/^\/([a-z0-9]+)\/?$/i)?.[1] || null;
    if (!/(^|\.)reddit\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1] || null;
  } catch { return null; }
}

export function normalizeMeme(raw) {
  if (!raw?.id || raw.over_18 || raw.nsfw || raw.spoiler || raw.stickied || raw.removed_by_category) return null;
  const media = raw.crosspost_parent_list?.[0] || raw;
  if (media.is_video || raw.is_video || /v\.redd\.it|youtube\.com|youtu\.be/.test(media.url || "")) return null;
  const images = [];
  const add = value => {
    if (typeof value !== "string") return;
    const decoded = value.replaceAll("&amp;", "&");
    if (/^https:\/\//.test(decoded) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(decoded)) images.push(decoded);
  };
  add(raw.imageUrl);
  add(media.url_overridden_by_dest || media.url);
  for (const image of raw.images || []) add(image);
  if (media.is_gallery && media.media_metadata) {
    for (const item of Object.values(media.media_metadata)) if (item.status === "valid") add(item.s?.u || item.s?.gif);
  }
  add(media.preview?.images?.[0]?.source?.url);
  const title = String(raw.title || "").trim();
  const selftext = String(raw.selftext || "").trim();
  if (!title || (!images.length && (selftext.length < 40 || selftext.startsWith("[removed]")))) return null;
  const permalink = raw.permalink?.startsWith("http") ? raw.permalink : `https://www.reddit.com${raw.permalink || `/comments/${raw.id}`}`;
  const candidate = {
    id: String(raw.id), title, subreddit: String(raw.subreddit || "reddit"),
    score: Number.isFinite(raw.score) && !raw.hide_score ? raw.score : null,
    permalink, imageUrl: images[0] || null, images: [...new Set(images)],
    mediaType: images.length ? "image" : "text", selftext: images.length ? "" : selftext.slice(0, 600),
    created: raw.created_utc ?? raw.created ?? null,
    discoveredAt: raw.discoveredAt || new Date().toISOString(),
    flair: raw.link_flair_text ?? raw.flair ?? "",
    numComments: raw.num_comments ?? raw.numComments ?? null,
    upvoteRatio: raw.upvote_ratio ?? raw.upvoteRatio ?? null,
    isGallery: Boolean(raw.is_gallery || raw.isGallery),
    discoverySource: raw.discoverySource || "arctic",
    observedAt: raw.observedAt || Date.now(),
    provenance: raw.provenance || [raw.discoverySource || 'arctic'],
    removed: Boolean(raw.removed),
    safety: { nsfw: Boolean(raw.over_18 || raw.nsfw), spoiler: Boolean(raw.spoiler), removed: Boolean(raw.removed_by_category) },
  };
  let result = { ...candidate, ...evaluateMeme(candidate) };
  if (raw.assetVerified && raw.asset?.sha256 && raw.asset?.differenceHash) {
    result = applyAssetAssessment(result, {
      usable: true, assetQualityScore: raw.assetQualityScore || 0,
      assetSignals: raw.assetSignals || [], assetWarnings: raw.assetWarnings || [], asset: raw.asset,
    });
  }
  return result;
}
