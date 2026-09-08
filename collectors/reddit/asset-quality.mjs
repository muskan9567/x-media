import { createHash } from "node:crypto";
import sharp from "sharp";

const MIN_BYTES = 10 * 1024;
const MAX_BYTES = 12 * 1024 * 1024;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;
const MIN_ASPECT = 0.28;
const MAX_ASPECT = 3.6;

const clamp = value => Math.max(0, Math.min(100, Math.round(value)));

export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let value = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    while (value) {
      distance += value & 1;
      value >>>= 1;
    }
  }
  return distance;
}

async function differenceHash(buffer) {
  const pixels = await sharp(buffer, { animated: false, failOn: "none" })
    .rotate()
    .resize(9, 8, { fit: "fill", kernel: "nearest" })
    .greyscale()
    .raw()
    .toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export async function inspectImage(buffer, contentType = "") {
  const bytes = buffer.length;
  const metadata = await sharp(buffer, {
    animated: false,
    failOn: "none",
    limitInputPixels: 80_000_000,
  }).metadata();
  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  const aspectRatio = height ? width / height : 0;
  const pixels = width * height;
  const signals = [];
  const warnings = [];
  let assetQualityScore = 38;

  if (bytes >= 30 * 1024) {
    assetQualityScore += 8;
    signals.push("substantial image file");
  } else if (bytes < MIN_BYTES) {
    assetQualityScore -= 28;
    warnings.push("image file is too small to reuse cleanly");
  }

  if (width >= 480 && height >= 320) {
    assetQualityScore += 18;
    signals.push(`${width}×${height} reusable resolution`);
  } else if (width >= MIN_WIDTH && height >= MIN_HEIGHT) {
    assetQualityScore += 8;
    signals.push(`${width}×${height} acceptable resolution`);
  } else {
    assetQualityScore -= 30;
    warnings.push(`${width}×${height} is too small for a useful meme`);
  }

  if (pixels >= 1_000_000) assetQualityScore += 10;
  else if (pixels >= 500_000) assetQualityScore += 6;

  if (aspectRatio >= 0.5 && aspectRatio <= 2.2) {
    assetQualityScore += 16;
    signals.push("share-friendly aspect ratio");
  } else if (aspectRatio >= MIN_ASPECT && aspectRatio <= MAX_ASPECT) {
    assetQualityScore += 5;
    warnings.push("unusually tall or wide layout");
  } else {
    assetQualityScore -= 30;
    warnings.push("extreme aspect ratio is awkward to share");
  }

  if (["jpeg", "png", "webp", "gif"].includes(metadata.format)) assetQualityScore += 6;
  if ((metadata.pages ?? 1) > 1) signals.push("animated image");

  const usable = bytes >= MIN_BYTES
    && bytes <= MAX_BYTES
    && width >= MIN_WIDTH
    && height >= MIN_HEIGHT
    && aspectRatio >= MIN_ASPECT
    && aspectRatio <= MAX_ASPECT;

  return {
    usable,
    assetQualityScore: clamp(assetQualityScore),
    assetSignals: signals,
    assetWarnings: warnings,
    asset: {
      width,
      height,
      bytes,
      format: metadata.format || contentType.replace(/^image\//, "") || "unknown",
      aspectRatio: Number(aspectRatio.toFixed(3)),
      sha256: createHash("sha256").update(buffer).digest("hex"),
      differenceHash: await differenceHash(buffer),
    },
  };
}

export function removeVisualDuplicates(memes, maximumDistance = 2) {
  const kept = [];
  const duplicates = [];
  for (const meme of memes) {
    if (!meme.asset?.differenceHash) {
      kept.push(meme);
      continue;
    }
    const match = kept.find(existing => existing.asset
      && (existing.asset.sha256 === meme.asset.sha256
        || hammingDistance(existing.asset.differenceHash, meme.asset.differenceHash) <= maximumDistance));
    if (match) duplicates.push({ removed: meme, kept: match });
    else kept.push(meme);
  }
  return { memes: kept, duplicates };
}
