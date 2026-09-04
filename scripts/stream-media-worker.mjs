import { once } from 'node:events';
import { Scraper, ErrorRateLimitStrategy } from '@the-convocation/twitter-scraper';

const safeMedia = (url) => {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['pbs.twimg.com', 'video.twimg.com'].includes(u.hostname) ? u.href : undefined; } catch { return undefined; }
};
class PageStop extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

export async function collectStream(username, maxPosts, resume, dependencies = {}) {
  const emit = dependencies.emit ?? (async (event) => { if (!process.stdout.write(JSON.stringify(event) + '\n')) await once(process.stdout, 'drain'); });
  const fetchPublic = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const ScraperClass = dependencies.Scraper ?? Scraper;
  const seen = new Set(resume?.seenPostIds ?? []);
  const cursors = new Set(resume?.cursor ? [resume.cursor] : []);
  let profile = resume, batch = [], batchesRead = resume?.batchesRead ?? 0, lastFlushed = seen.size;
  let pages = 0, lastRequestAt = 0, retryAt, lastStatus, duplicates = 0, reason = 'exhausted';
  const flush = async () => {
    if (!batch.length && lastFlushed === seen.size) return;
    batchesRead++;
    await emit({ type: 'batch', items: batch, postsScanned: seen.size, batchesRead });
    batch = []; lastFlushed = seen.size;
  };
  const scraper = new ScraperClass({ rateLimitStrategy: new ErrorRateLimitStrategy(), fetch: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const timeline = /\/UserTweets$/.test(url.pathname);
    if (timeline) {
      const variables = JSON.parse(url.searchParams.get('variables'));
      if (pages > 0) {
        // A new request means the iterator has consumed the previous page.
        // Save its media before its cursor so interruption cannot skip attachments.
        await flush();
        const cursor = variables.cursor;
        if (!cursor) throw new PageStop('exhausted');
        if (cursors.has(cursor)) throw new PageStop('repeated');
        cursors.add(cursor);
        await emit({ type: 'checkpoint', checkpoint: {
          username, userId: profile.userId, displayName: profile.displayName, profileImageUrl: profile.profileImageUrl,
          cursor, seenPostIds: [...seen], batchesRead,
        } });
        // Give new searches a turn instead of draining the budget on one account.
        if (pages >= 3) throw new PageStop('yield');
      } else if (resume?.cursor) {
        variables.cursor = resume.cursor;
      }
      variables.count = 20;
      url.searchParams.set('variables', JSON.stringify(variables));
      const wait = 2000 - (Date.now() - lastRequestAt);
      if (wait > 0) await sleep(wait);
      input = input instanceof Request ? new Request(url, input) : url.toString();
      lastRequestAt = Date.now();
    }
    const response = await fetchPublic(input, init);
    lastStatus = response.status;
    if (timeline && response.ok) pages++;
    if (response.status === 429) {
      const after = response.headers.get('retry-after');
      const reset = response.headers.get('x-rate-limit-reset');
      const parsed = after ? (/^\d+$/.test(after) ? Date.now() + Number(after) * 1000 : Date.parse(after)) : Number(reset) * 1000;
      if (Number.isFinite(parsed) && parsed > Date.now()) retryAt = parsed;
    }
    return response;
  }});
  try {
    if (!profile) {
      let raw;
      try { raw = await scraper.getProfile(username); }
      catch (error) {
        if (lastStatus === 429) throw error;
        // Public profile fallback supplies identity; timeline access stays anonymous.
        const response = await fetchPublic(`https://api.fxtwitter.com/${username}`, { signal: AbortSignal.timeout(12000), redirect: 'error' });
        if (!response.ok) throw error;
        const data = await response.json();
        raw = { username: data.user?.screen_name, userId: data.user?.id, name: data.user?.name, avatar: data.user?.avatar_url, isPrivate: data.user?.protected };
      }
      if (raw.isPrivate || raw.username?.toLowerCase() !== username || !/^\d+$/.test(raw.userId ?? '')) throw new PageStop('unavailable');
      profile = { username, userId: raw.userId, displayName: raw.name || username, profileImageUrl: safeMedia(raw.avatar) };
    }
    if (profile.username !== username) throw new PageStop('unavailable');
    await emit({ type: 'profile', username, displayName: profile.displayName, profileImageUrl: profile.profileImageUrl });
    if (seen.size >= maxPosts) throw new PageStop('limit');
    for await (const tweet of scraper.getTweetsByUserId(profile.userId, maxPosts)) {
      if (!tweet.id || seen.has(tweet.id)) {
        if (++duplicates >= 40) { reason = 'repeated'; break; }
        continue;
      }
      if (!/^\d+$/.test(tweet.id)) continue;
      duplicates = 0; seen.add(tweet.id);
      if (tweet.username?.toLowerCase() === username && !tweet.isRetweet && !tweet.retweetedStatusId) {
        const date = tweet.timeParsed ?? new Date((tweet.timestamp || 0) * 1000);
        if (Number.isFinite(date.getTime())) {
          const common = { postId: tweet.id, postUrl: `https://x.com/${username}/status/${tweet.id}`, postText: tweet.text || '', createdAt: date.toISOString() };
          for (const photo of tweet.photos || []) {
            const url = safeMedia(photo.url);
            if (url) batch.push({ ...common, id: `${tweet.id}:${photo.id}`, media: { mediaKey: photo.id, type: 'photo', url, altText: photo.alt_text, variants: [] } });
          }
          for (const video of tweet.videos || []) {
            const raw = tweet.__raw_UNSTABLE?.extended_entities?.media?.find(m => m.id_str === video.id);
            const url = safeMedia(video.url);
            batch.push({ ...common, id: `${tweet.id}:${video.id}`, media: { mediaKey: video.id, type: raw?.type === 'animated_gif' ? 'animated_gif' : 'video', previewImageUrl: safeMedia(video.preview), variants: url ? [{ url, contentType: 'video/mp4' }] : [] } });
          }
        }
      }
      if (seen.size % 10 === 0) await flush();
      if (seen.size >= maxPosts) { reason = 'limit'; break; }
    }
  } catch (error) {
    reason = error instanceof PageStop ? error.reason : lastStatus === 429 || /rate.?limit|\b429\b/i.test(error.message) ? 'rate_limit'
      : /private|protected|not found|does not exist|suspended/i.test(error.message) ? 'unavailable' : 'upstream';
  }
  await flush();
  await emit({ type: 'done', reason, retryAt });
}
