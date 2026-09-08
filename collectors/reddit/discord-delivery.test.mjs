import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDiscordDelivery, discordMessage, isDiscordEligible } from "./discord-delivery.mjs";

const meme = (id, overrides = {}) => ({ id, title: `Claude coding meme ${id}`, subreddit: "ProgrammerHumor", score: 1200, qualityScore: 94, assetQualityScore: 92, topicRelevant: true, imageUrl: `https://i.redd.it/${id}.png`, permalink: `https://reddit.com/comments/${id}`, created: Date.parse("2026-08-26T15:59:00.000Z") / 1000, tier: "S", reviewStatus: "keep", asset: { sha256: `${id}-sha`, differenceHash: "" }, ...overrides });
const persona = (...channelIds) => [{ id: "reddit-meme-sender", discordBindings: channelIds.map((channelId) => ({ channelId, webhookSecretRef: "configured" })) }];

test("only reviewed, high-resolution A/S-tier memes are eligible", () => {
  assert.equal(isDiscordEligible(meme("s")), true);
  assert.equal(isDiscordEligible({ ...meme("a"), tier: "A", qualityScore: 70 }), true);
  assert.equal(isDiscordEligible({ ...meme("low-content"), tier: "A", qualityScore: 69 }), false);
  assert.equal(isDiscordEligible({ ...meme("b"), tier: "B", qualityScore: 90 }), false);
  assert.equal(isDiscordEligible({ ...meme("low-asset"), assetQualityScore: 84 }), false);
  assert.equal(isDiscordEligible({ ...meme("off-topic"), topicRelevant: false }), false);
  assert.equal(isDiscordEligible({ ...meme("pending"), reviewStatus: undefined }), false);
  assert.match(discordMessage(meme("s")), /High-quality Reddit meme · S-tier/);
  assert.match(discordMessage(meme("s")), /<https:\/\/reddit\.com\/comments\/s>/);
});

test("first run primes the backlog and sends each future keeper once", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meme-delivery-"));
  try {
    const stateFile = path.join(directory, "state.json");
    const keyFile = path.join(directory, "agent.key");
    await writeFile(keyFile, "test-key", "utf8");
    const calls = [];
    const delivery = createDiscordDelivery({ stateFile, agentKeyFile: keyFile, sendBacklog: false, fetchImpl: async (_url, options = {}) => {
      if (!options.method) return Response.json(persona("channel-1"));
      calls.push(JSON.parse(options.body)); return Response.json({ sent: true });
    }, now: () => Date.parse("2026-08-26T16:00:00.000Z"), logger: { log() {}, warn() {} } });
    await delivery.sync([meme("existing")]);
    assert.equal(calls.length, 0);
    await delivery.sync([meme("existing"), meme("new")]);
    assert.equal(calls.length, 1);
    assert.match(calls[0].content, /Claude coding meme new/);
    assert.equal(calls[0].channelId, "channel-1");
    await delivery.sync([meme("new")]);
    assert.equal(calls.length, 1);
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    assert.ok(saved.sent.existing.primed);
    assert.ok(saved.sent.new.sentAt);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  }
});

test("failed deliveries remain pending for retry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meme-delivery-"));
  try {
    const stateFile = path.join(directory, "state.json");
    const keyFile = path.join(directory, "agent.key");
    await writeFile(keyFile, "test-key", "utf8");
    const delivery = createDiscordDelivery({ stateFile, agentKeyFile: keyFile, sendBacklog: true, fetchImpl: async (_url, options = {}) => options.method ? Response.json({ error: "No channel is bound." }, { status: 400 }) : Response.json(persona("channel-1")), now: () => Date.parse("2026-08-26T16:00:00.000Z"), logger: { log() {}, warn() {} } });
    await delivery.sync([meme("retry")]);
    assert.equal(delivery.status().pending, 1);
    assert.match(delivery.status().lastError, /No channel is bound/);
    assert.equal(delivery.status().nextDeliveryAt, "2026-08-26T16:00:30.000Z");
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  }
});

test("broadcasts to every binding and retries only channels that failed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meme-delivery-"));
  try {
    const stateFile = path.join(directory, "state.json");
    const keyFile = path.join(directory, "agent.key");
    await writeFile(keyFile, "test-key", "utf8");
    let clock = Date.parse("2026-08-26T16:00:00.000Z");
    let channelTwoFailures = 1;
    const calls = [];
    const delivery = createDiscordDelivery({ stateFile, agentKeyFile: keyFile, sendBacklog: true, now: () => clock, logger: { log() {}, warn() {} }, fetchImpl: async (_url, options = {}) => {
      if (!options.method) return Response.json(persona("channel-1", "channel-2"));
      const body = JSON.parse(options.body); calls.push(body.channelId);
      if (body.channelId === "channel-2" && channelTwoFailures--) return Response.json({ error: "Temporary Discord failure." }, { status: 503 });
      return Response.json({ sent: true });
    } });
    await delivery.sync([meme("broadcast")]);
    assert.deepEqual(calls, ["channel-1", "channel-2"]);
    assert.equal(delivery.status().pending, 1);
    clock += 31_000;
    await delivery.flush();
    assert.deepEqual(calls, ["channel-1", "channel-2", "channel-2"]);
    assert.equal(delivery.status().pending, 0);
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    assert.deepEqual(saved.sent.broadcast.channelIds.sort(), ["channel-1", "channel-2"]);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  }
});

test("sends one fresh meme per three-minute interval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meme-delivery-"));
  try {
    const stateFile = path.join(directory, "state.json");
    const keyFile = path.join(directory, "agent.key");
    await writeFile(keyFile, "test-key", "utf8");
    let clock = Date.parse("2026-08-26T16:00:00.000Z");
    const calls = [];
    const delivery = createDiscordDelivery({ stateFile, agentKeyFile: keyFile, sendBacklog: true, deliveryIntervalMs: 180_000, now: () => clock, logger: { log() {}, warn() {} }, fetchImpl: async (_url, options = {}) => {
      if (!options.method) return Response.json(persona("channel-1"));
      calls.push(JSON.parse(options.body)); return Response.json({ sent: true });
    } });
    await delivery.sync([meme("first"), meme("second")]);
    assert.deepEqual(calls.map((call) => call.content.match(/Claude coding meme (first|second)/)?.[1]), ["first"]);
    assert.equal(delivery.status().pending, 1);
    const preview = delivery.preview();
    assert.equal(preview.length, 1);
    assert.equal(preview[0].title, "Claude coding meme second");
    assert.equal(preview[0].source, "r/ProgrammerHumor");
    assert.equal(preview[0].scheduledAt, "2026-08-26T16:03:00.000Z");
    assert.equal(JSON.stringify(preview).includes("webhookSecretRef"), false);
    assert.equal(Object.keys(JSON.parse(await readFile(stateFile, "utf8")).pending).length, 1);
    await delivery.flush();
    assert.equal(calls.length, 1);
    clock += 180_001;
    await delivery.flush();
    assert.deepEqual(calls.map((call) => call.content.match(/Claude coding meme (first|second)/)?.[1]), ["first", "second"]);
    assert.equal(delivery.status().pending, 0);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  }
});

test("sends the newest eligible meme first", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meme-delivery-"));
  try {
    const stateFile = path.join(directory, "state.json");
    const keyFile = path.join(directory, "agent.key");
    await writeFile(keyFile, "test-key", "utf8");
    const calls = [];
    const delivery = createDiscordDelivery({ stateFile, agentKeyFile: keyFile, sendBacklog: true, now: () => Date.parse("2026-08-26T16:00:00.000Z"), logger: { log() {}, warn() {} }, fetchImpl: async (_url, options = {}) => {
      if (!options.method) return Response.json(persona("channel-1"));
      calls.push(JSON.parse(options.body)); return Response.json({ sent: true });
    } });
    await delivery.sync([
      meme("older", { created: Date.parse("2026-08-26T14:00:00.000Z") / 1000 }),
      meme("newest", { created: Date.parse("2026-08-26T15:30:00.000Z") / 1000 }),
    ]);
    assert.match(calls[0].content, /Claude coding meme newest/);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  }
});

test("does not resend the same visual under a different Reddit post id", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meme-delivery-"));
  try {
    const stateFile = path.join(directory, "state.json");
    const keyFile = path.join(directory, "agent.key");
    await writeFile(keyFile, "test-key", "utf8");
    let clock = Date.parse("2026-08-26T16:00:00.000Z");
    const calls = [];
    const delivery = createDiscordDelivery({ stateFile, agentKeyFile: keyFile, sendBacklog: true, now: () => clock, logger: { log() {}, warn() {} }, fetchImpl: async (_url, options = {}) => {
      if (!options.method) return Response.json(persona("channel-1"));
      calls.push(JSON.parse(options.body)); return Response.json({ sent: true });
    } });
    const visual = { sha256: "same-image", differenceHash: "0123456789abcdef" };
    await delivery.sync([meme("original", { asset: visual })]);
    clock += 180_001;
    await delivery.sync([meme("crosspost", { asset: visual })]);
    assert.equal(calls.length, 1);
    assert.match(calls[0].content, /Claude coding meme original/);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  }
});

test("backfills visual history for sent records from the reviewed cache", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meme-delivery-"));
  try {
    const stateFile = path.join(directory, "state.json");
    const historyFile = path.join(directory, "pool-cache.json");
    const keyFile = path.join(directory, "agent.key");
    await writeFile(keyFile, "test-key", "utf8");
    await writeFile(stateFile, JSON.stringify({ schemaVersion: 2, initializedAt: "2026-08-26T12:00:00.000Z", sent: { original: { sentAt: "2026-08-26T12:00:00.000Z" } }, pending: {} }), "utf8");
    const visual = { sha256: "cached-image", differenceHash: "0123456789abcdef" };
    await writeFile(historyFile, JSON.stringify([meme("original", { asset: visual })]), "utf8");
    const calls = [];
    const delivery = createDiscordDelivery({ stateFile, visualHistoryFile: historyFile, agentKeyFile: keyFile, sendBacklog: true, now: () => Date.parse("2026-08-26T16:00:00.000Z"), logger: { log() {}, warn() {} }, fetchImpl: async (_url, options = {}) => {
      if (!options.method) return Response.json(persona("channel-1"));
      calls.push(JSON.parse(options.body)); return Response.json({ sent: true });
    } });
    await delivery.sync([meme("crosspost", { asset: visual })]);
    assert.equal(calls.length, 0);
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(saved.sent.original.sha256, "cached-image");
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  }
});

test("migrates away from the historical queue without posting it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meme-delivery-"));
  try {
    const stateFile = path.join(directory, "state.json");
    const keyFile = path.join(directory, "agent.key");
    await writeFile(keyFile, "test-key", "utf8");
    await writeFile(stateFile, JSON.stringify({ schemaVersion: 1, initializedAt: "2026-08-25T00:00:00.000Z", sent: {}, pending: { old: { meme: meme("old"), attempts: 0, nextAttemptAt: 0 } } }), "utf8");
    const calls = [];
    const delivery = createDiscordDelivery({ stateFile, agentKeyFile: keyFile, sendBacklog: true, now: () => Date.parse("2026-08-26T16:00:00.000Z"), logger: { log() {}, warn() {} }, fetchImpl: async () => { calls.push(true); return Response.json({ sent: true }); } });
    await delivery.sync([meme("current")]);
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(saved.schemaVersion, 3);
    assert.deepEqual(saved.pending, {});
    assert.equal(saved.sent.current.freshReset, true);
    assert.equal(calls.length, 0);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  }
});
