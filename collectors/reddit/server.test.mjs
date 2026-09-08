import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

test("offline startup serves cache and image downloads; keep, clear, and reject survive restart", { timeout: 15000 }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "meme-finder-test-"));
  let child;
  const fixture = { id: "abc123", title: "When Claude fixes one tiny bug", subreddit: "ProgrammerHumor", score: 500,
    flair: "Meme", imageUrl: "https://i.redd.it/fixture.png", created: Math.floor(Date.now() / 1000),
    assetVerified: true, assetQualityScore: 92, asset: { sha256: "abc", differenceHash: "1234567890abcdef" } };
  const imageBytes = Buffer.from("cached image fixture");
  await writeFile(path.join(folder, "pool-cache.json"), JSON.stringify([fixture]));
  await writeFile(path.join(folder, "meme-reviews.json"), JSON.stringify({ abc123: { verdict: "keep", source: "manual" } }));
  const images = path.join(folder, "runtime", "images");
  await mkdir(images, { recursive: true });
  await writeFile(path.join(images, createHash("sha256").update(fixture.imageUrl).digest("hex") + ".json"), JSON.stringify({ type: "image/png", data: imageBytes.toString("base64") }));

  async function start() {
    child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
      env: { ...process.env, PORT: "0", NO_BROWSER: "1", MEME_DATA_DIR: folder, MEME_OFFLINE: "1", MEME_DISCORD_ENABLED: "0" },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    const base = await new Promise((resolve, reject) => {
      child.stdout.on("data", chunk => { logs += chunk; const match = logs.match(/http:\/\/localhost:(\d+)/); if (match) resolve("http://127.0.0.1:" + match[1]); });
      child.once("error", reject);
      child.once("exit", code => reject(Error("Server exited " + code)));
    });
    for (let i = 0; i < 30; i++) {
      if ((await (await fetch(base + "/api/stats")).json()).ready) return base;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error("Offline startup did not become ready");
  }
  async function stop() { if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; } }
  try {
    let base = await start();
    const listing = async query => (await (await fetch(base + "/api/memes" + (query || ""))).json()).memes;
    const review = verdict => fetch(base + "/api/reviews/abc123", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict }) });
    assert.equal((await listing()).length, 1);
    const firstBatch=await (await fetch(base+'/api/picks')).json();
    assert.ok(firstBatch.batchId);
    const settings=await (await fetch(base+'/api/settings')).json();assert.equal(settings.settings.visionEnabled,false);assert.equal(settings.settings.discordEnabled,false);
    assert.equal((await fetch(base+'/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({visionEnabled:true})})).status,403);
    const saved=await (await fetch(base+'/api/feedback/abc123',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'favorite'})})).json();
    assert.equal((await listing('?view=saved')).length,1);
    assert.equal((await fetch(base+'/api/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:saved.eventId})})).status,200);
    assert.equal((await listing('?view=saved')).length,0);
    const feedOne=await(await fetch(base+'/api/feed')).json(),feedTwo=await(await fetch(base+'/api/feed')).json();assert.deepEqual(feedOne.memes,feedTwo.memes);assert.equal(feedOne.tickMs,8000);
    assert.equal((await(await fetch(base+'/api/memes/abc123')).json()).meme.id,'abc123');
    const legacy=await fetch(base+'/api/feed',{headers:{Accept:'text/event-stream'}});assert.match(legacy.headers.get('content-type'),/text\/event-stream/);const reader=legacy.body.getReader();let event='';while(!event.includes('clientId')){const part=await reader.read();if(part.done)break;event+=new TextDecoder().decode(part.value);}assert.match(event,/event: meme/);assert.match(event,/clientId/);await reader.cancel();
    assert.equal((await fetch(base+'/api/skip',{method:'POST'})).status,204);
    assert.ok(Array.isArray((await(await fetch(base+'/api/history')).json()).aired));
    assert.equal((await(await fetch(base+'/api/status')).json()).outbox.enabled,false);
    const download = await fetch(base + "/download/abc123");
    assert.match(download.headers.get("content-disposition"), /attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), imageBytes);
    assert.equal((await review("clear")).status, 200);
    assert.equal((await listing()).length, 0);
    assert.equal((await listing("?review=unreviewed")).length, 1);
    assert.equal((await review("keep")).status, 200);
    assert.equal((await listing()).length, 1);
    assert.equal((await review("reject")).status, 200);
    assert.equal((await listing()).length, 0);
    await stop();
    base = await start();
    assert.equal((await listing()).length, 0);
    assert.equal((await listing("?review=unreviewed")).length, 0);
    assert.equal((await fetch(base + "/img?u=https://example.com/secret")).status, 502);
  } finally {
    await stop();
    assert.ok(path.resolve(folder).startsWith(path.resolve(tmpdir()) + path.sep + "meme-finder-test-"));
    await rm(folder, { recursive: true, force: true });
  }
});
