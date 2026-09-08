import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { hammingDistance, inspectImage, removeVisualDuplicates } from "./asset-quality.mjs";

async function image(width, height, seed = 17) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * seed + Math.floor(i / (width * 3)) * 29) % 256;
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
}

test("asset inspection accepts reusable images and rejects thumbnails", async () => {
  const good = await inspectImage(await image(900, 700));
  const tiny = await inspectImage(await image(120, 90));
  assert.equal(good.usable, true);
  assert.ok(good.assetQualityScore >= 70);
  assert.equal(good.asset.width, 900);
  assert.equal(tiny.usable, false);
});

test("difference hashes support near-duplicate removal", async () => {
  const buffer = await image(800, 600, 17);
  const first = { id: "best", asset: (await inspectImage(buffer)).asset };
  const duplicate = { id: "copy", asset: (await inspectImage(buffer)).asset };
  const patterned = await image(800, 600, 43);
  const different = { id: "different", asset: (await inspectImage(patterned)).asset };
  const result = removeVisualDuplicates([first, duplicate, different]);
  assert.deepEqual(result.memes.map(meme => meme.id), ["best", "different"]);
  assert.equal(result.duplicates[0].kept.id, "best");
  assert.equal(hammingDistance(first.asset.differenceHash, duplicate.asset.differenceHash), 0);
});
