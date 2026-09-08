import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_MAX_AGE_MS, isRecentMeme } from "./freshness.mjs";
import { hammingDistance } from "./asset-quality.mjs";

const STATE_VERSION = 3;
const MAX_HISTORY = 2_000;
export const MIN_DISCORD_QUALITY = 70;
export const MIN_DISCORD_ASSET_QUALITY = 85;

export function isDiscordEligible(meme) {
  return Boolean(meme?.id
    && (meme.tier === "S" || meme.tier === "A")
    && meme.reviewStatus === "keep"
    && meme.topicRelevant === true
    && Number(meme.qualityScore) >= MIN_DISCORD_QUALITY
    && Number(meme.assetQualityScore) >= MIN_DISCORD_ASSET_QUALITY);
}

export function discordMessage(meme) {
  const title = String(meme.title || "High-quality Reddit meme").trim().slice(0, 280);
  const source = meme.subreddit ? `r/${meme.subreddit}` : "Reddit";
  const score = Number.isFinite(meme.score) ? ` · ▲ ${meme.score.toLocaleString()}` : "";
  const quality = Number.isFinite(meme.qualityScore) ? ` · quality ${meme.qualityScore}` : "";
  const redditLink = meme.permalink ? `<${meme.permalink}>` : "";
  return [`**High-quality Reddit meme · ${meme.tier || "ranked"}-tier**`, `**${title}**`, `${source}${score}${quality}`, meme.imageUrl || "", redditLink].filter(Boolean).join("\n").slice(0, 2_000);
}

function freshState() {
  return { schemaVersion: STATE_VERSION, initializedAt: null, freshQueueResetAt: null, sent: {}, pending: {}, lastSuccessAt: null, lastErrorAt: null, lastError: "" };
}

function boundedEntries(values) {
  return Object.fromEntries(Object.entries(values).sort(([, left], [, right]) => String(right.at || right.sentAt || "").localeCompare(String(left.at || left.sentAt || ""))).slice(0, MAX_HISTORY));
}

function visualIdentity(meme) {
  return {
    imageUrl: String(meme?.imageUrl || ""),
    sha256: String(meme?.asset?.sha256 || meme?.sha256 || ""),
    differenceHash: String(meme?.asset?.differenceHash || meme?.differenceHash || ""),
  };
}

function sameVisual(left, right) {
  const a = visualIdentity(left);
  const b = visualIdentity(right);
  if (a.sha256 && b.sha256 && a.sha256 === b.sha256) return true;
  if (a.differenceHash && b.differenceHash && hammingDistance(a.differenceHash, b.differenceHash) <= 2) return true;
  return Boolean(a.imageUrl && b.imageUrl && a.imageUrl === b.imageUrl);
}

export function createDiscordDelivery({
  stateFile,
  visualHistoryFile = stateFile ? path.resolve(path.dirname(stateFile), "..", "pool-cache.json") : "",
  botId = "reddit-meme-sender",
  agentUrl = process.env.NOTEBOOK_AGENT_URL || "http://127.0.0.1:4317",
  agentKeyFile = process.env.NOTEBOOK_AGENT_KEY_FILE || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "note-overlay", "bot-agent.key"),
  sendBacklog = process.env.MEME_SEND_BACKLOG === "1",
  enabled = process.env.MEME_DISCORD_ENABLED !== "0",
  resolveMeme = null,
  destinationChannels = null,
  sendMeme = null,
  deliveryIntervalMs = Math.max(60_000, Number(process.env.MEME_DELIVERY_INTERVAL_MS) || 3 * 60_000),
  maxPending = Math.max(1, Number(process.env.MEME_MAX_PENDING) || 60),
  maxAgeMs = Math.max(60 * 60_000, Number(process.env.MEME_MAX_AGE_HOURS || 168) * 60 * 60_000 || DEFAULT_MAX_AGE_MS),
  fetchImpl = fetch,
  now = () => Date.now(),
  logger = console,
} = {}) {
  let state = freshState();
  let loaded = false;
  let flushing = null;
  let resetLegacyQueue = false;
  let persisting = Promise.resolve();
  const isEnabled = () => typeof enabled === 'function' ? enabled() : enabled;

  async function load() {
    if (loaded) return state;
    try {
      const parsed = JSON.parse(await readFile(stateFile, "utf8"));
      if (parsed?.schemaVersion === 1) {
        state = { ...freshState(), ...parsed, schemaVersion: STATE_VERSION, pending: {}, sent: parsed.sent || {} };
        resetLegacyQueue = true;
      } else if (parsed?.schemaVersion === 2 || parsed?.schemaVersion === STATE_VERSION) {
        state = { ...freshState(), ...parsed, schemaVersion: STATE_VERSION, sent: parsed.sent || {}, pending: parsed.pending || {} };
      }
    } catch {}
    if (visualHistoryFile) {
      try {
        const catalog = JSON.parse(await readFile(visualHistoryFile, "utf8"));
        for (const meme of Array.isArray(catalog) ? catalog : []) {
          if (!state.sent[meme?.id]) continue;
          const identity = visualIdentity(meme);
          state.sent[meme.id] = {
            ...state.sent[meme.id],
            ...(identity.imageUrl ? { imageUrl: identity.imageUrl } : {}),
            ...(identity.sha256 ? { sha256: identity.sha256 } : {}),
            ...(identity.differenceHash ? { differenceHash: identity.differenceHash } : {}),
          };
        }
      } catch {}
    }
    loaded = true;
    return state;
  }

  async function writeState() {
    await mkdir(path.dirname(stateFile), { recursive: true });
    state.sent = boundedEntries(state.sent);
    const temporary = `${stateFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, stateFile);
  }
  function persist() { const task = persisting.then(writeState); persisting = task.catch(() => {}); return task; }
  function discardPending(id, item) {
    const channels = Object.keys(item.deliveredChannelIds || {});
    if (channels.length) state.sent[id] = { sentAt: Object.values(item.deliveredChannelIds).sort().at(-1), title: item.meme?.title, channelIds: channels, partial: true, cancelled: true, ...visualIdentity(item.meme) };
    delete state.pending[id];
  }

  function queue(meme) {
    if (!isDiscordEligible(meme) || !isRecentMeme(meme, { now: now(), maxAgeMs }) || state.sent[meme.id] || state.pending[meme.id]) return false;
    if (Object.values(state.sent).some((item) => sameVisual(meme, item))
      || Object.values(state.pending).some((item) => sameVisual(meme, item?.meme))) return false;
    state.pending[meme.id] = { meme: { id: meme.id, title: meme.title, subreddit: meme.subreddit, score: meme.score, qualityScore: meme.qualityScore, assetQualityScore: meme.assetQualityScore, topicRelevant: meme.topicRelevant, imageUrl: meme.imageUrl, permalink: meme.permalink, created: meme.created, tier: meme.tier, reviewStatus: meme.reviewStatus, ...visualIdentity(meme) }, attempts: 0, nextAttemptAt: now(), at: new Date(now()).toISOString(), error: "" };
    return true;
  }

  async function agentKey() {
    if (!existsSync(agentKeyFile)) throw new Error("Notes Overlay agent service is not available.");
    const key = (await readFile(agentKeyFile, "utf8")).trim();
    if (!key) throw new Error("Notes Overlay agent service is not available.");
    return key;
  }

  async function destinationChannelIds() {
    if (destinationChannels) return destinationChannels();
    const response = await fetchImpl(`${agentUrl.replace(/\/$/, "")}/api/agent/personas`, {
      headers: { "x-bot-forge-key": await agentKey() },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => []);
    if (!response.ok) throw new Error(body?.error || `Notes Overlay destination lookup failed (${response.status}).`);
    const persona = Array.isArray(body) ? body.find((item) => item?.id === botId || item?.slug === botId) : null;
    const channels = (persona?.discordBindings || [])
      .filter((binding) => binding?.channelId && binding?.webhookSecretRef === "configured")
      .map((binding) => String(binding.channelId));
    if (!channels.length) throw new Error("This bot has no Discord webhook destination.");
    return [...new Set(channels)];
  }

  async function post(meme, channelId) {
    if (sendMeme) return sendMeme(meme, channelId);
    const response = await fetchImpl(`${agentUrl.replace(/\/$/, "")}/api/agent/personas/${encodeURIComponent(botId)}/send`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-forge-key": await agentKey() },
      body: JSON.stringify({ content: discordMessage(meme), channelId }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.sent) throw new Error(body?.error || `Notes Overlay delivery failed (${response.status}).`);
  }

  async function flush() {
    await load();
    if (!isEnabled() || flushing) return flushing;
    flushing = (async () => {
      for (const [id, item] of Object.entries(state.pending)) {
        if (resolveMeme) { const current = await resolveMeme(id); if (!current) { discardPending(id, item); continue; } item.meme = current; }
        if (isRecentMeme(item.meme, { now: now(), maxAgeMs }) && isDiscordEligible(item.meme)) continue;
        discardPending(id, item);

        logger.log(`[discord] dropped stale or below-quality pending meme ${id}`);
      }
      const lastSuccess = Date.parse(state.lastSuccessAt || "");
      if (Number.isFinite(lastSuccess) && now() - lastSuccess < deliveryIntervalMs) {
        await persist();
        return;
      }
      for (const [id, item] of Object.entries(state.pending)) {
        if (Number(item.nextAttemptAt || 0) > now()) continue;
        try {
          const channelIds = await destinationChannelIds();
          item.deliveredChannelIds ||= {};
          for (const channelId of channelIds) {
            if (item.deliveredChannelIds[channelId]) continue;
            if (!isEnabled()) { await persist(); return; }
            if (resolveMeme) { const current = await resolveMeme(id); if (!current || !isDiscordEligible(current) || !isRecentMeme(current, { now: now(), maxAgeMs })) { discardPending(id, item); await persist(); return; } item.meme = current; }
            if (!isDiscordEligible(item.meme) || !isRecentMeme(item.meme, { now: now(), maxAgeMs })) { discardPending(id, item); await persist(); return; }
            await post(item.meme, channelId);
            item.deliveredChannelIds[channelId] = new Date(now()).toISOString();
            await persist();
          }
          state.sent[id] = { sentAt: new Date(now()).toISOString(), title: item.meme.title, tier: item.meme.tier, channelIds: Object.keys(item.deliveredChannelIds), ...visualIdentity(item.meme) };
          delete state.pending[id];
          state.lastSuccessAt = new Date(now()).toISOString();
          state.lastError = "";
          logger.log(`[discord] sent fresh ${item.meme.tier}-tier meme ${id}`);
          break;
        } catch (error) {
          item.attempts = Number(item.attempts || 0) + 1;
          item.error = String(error.message || "Delivery failed.").slice(0, 300);
          item.nextAttemptAt = now() + Math.min(5 * 60_000, 30_000 * (2 ** Math.min(item.attempts - 1, 7)));
          state.lastErrorAt = new Date(now()).toISOString();
          state.lastError = item.error;
          logger.warn(`[discord] ${item.error} Retry scheduled.`);
          break;
        }
      }
      await persist();
    })().finally(() => { flushing = null; });
    return flushing;
  }

  async function sync(memes) {
    await load();
    const eligible = (memes || [])
      .filter((meme) => isDiscordEligible(meme) && isRecentMeme(meme, { now: now(), maxAgeMs }))
      .sort((left, right) => Number(right.qualityScore || 0) - Number(left.qualityScore || 0)
        || Number(right.created || 0) - Number(left.created || 0));
    if (resetLegacyQueue) {
      const timestamp = new Date(now()).toISOString();
      for (const meme of eligible) if (!state.sent[meme.id]) state.sent[meme.id] = { sentAt: timestamp, title: meme.title, tier: meme.tier, primed: true, freshReset: true, ...visualIdentity(meme) };
      state.freshQueueResetAt = timestamp;
      resetLegacyQueue = false;
      await persist();
      logger.log(`[discord] discarded the historical queue and baselined ${eligible.length} current recent meme(s).`);
      return status();
    }
    if (!state.initializedAt && !sendBacklog) {
      const timestamp = new Date(now()).toISOString();
      for (const meme of eligible) state.sent[meme.id] = { sentAt: timestamp, title: meme.title, tier: meme.tier, primed: true, ...visualIdentity(meme) };
      state.initializedAt = timestamp;
      await persist();
      logger.log(`[discord] delivery baseline initialized with ${eligible.length} existing fresh meme(s); future keepers will be sent.`);
      return status();
    }
    if (!state.initializedAt) state.initializedAt = new Date(now()).toISOString();
    for (const meme of eligible) {
      if (Object.keys(state.pending).length >= maxPending) break;
      queue(meme);
    }
    await flush();
    return status();
  }

  async function enqueue(meme) {
    await load();
    if (!state.initializedAt) state.initializedAt = new Date(now()).toISOString();
    const queued = queue(meme);
    if (queued) await persist();
    void flush();
    return queued;
  }

  function status() {
    const lastSuccess = Date.parse(state.lastSuccessAt || "");
    const pendingItems = Object.values(state.pending);
    const nextRetry = Math.min(...pendingItems.map(item => Number(item.nextAttemptAt)).filter(Number.isFinite));
    const cadenceAt = Number.isFinite(lastSuccess) ? lastSuccess + deliveryIntervalMs : now();
    const nextAt = pendingItems.length ? Math.max(cadenceAt, Number.isFinite(nextRetry) ? nextRetry : now()) : cadenceAt;
    return { enabled: isEnabled(), initialized: Boolean(state.initializedAt), pending: pendingItems.length, sent: Object.keys(state.sent).length, lastSuccessAt: state.lastSuccessAt, nextDeliveryAt: new Date(nextAt).toISOString(), lastErrorAt: state.lastErrorAt, lastError: state.lastError };
  }

  function preview(limit = 60) {
    const snapshot = status();
    const firstDeliveryAt = Date.parse(snapshot.nextDeliveryAt || "");
    return Object.values(state.pending).slice(0, Math.max(0, Math.min(60, Number(limit) || 0))).map((item, index) => {
      const meme = item.meme || {};
      return {
        id: String(meme.id || `pending-${index + 1}`),
        title: String(meme.title || "Untitled meme").slice(0, 280),
        source: meme.subreddit ? `r/${String(meme.subreddit).slice(0, 120)}` : "Reddit",
        tier: ["S", "A", "B"].includes(meme.tier) ? meme.tier : undefined,
        qualityScore: Number.isFinite(meme.qualityScore) ? Math.max(0, Math.min(100, meme.qualityScore)) : undefined,
        assetQualityScore: Number.isFinite(meme.assetQualityScore) ? Math.max(0, Math.min(100, meme.assetQualityScore)) : undefined,
        imageUrl: String(meme.imageUrl || ""),
        sourceUrl: String(meme.permalink || ""),
        message: discordMessage(meme),
        scheduledAt: Number.isFinite(firstDeliveryAt) ? new Date(firstDeliveryAt + index * deliveryIntervalMs).toISOString() : undefined,
      };
    });
  }

  return { enqueue, flush, load, preview, status, sync };
}
