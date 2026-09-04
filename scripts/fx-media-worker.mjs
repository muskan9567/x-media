import { once } from 'node:events';

const safeUrl = (value) => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['pbs.twimg.com', 'video.twimg.com'].includes(u.hostname) ? u.href : undefined; } catch { return undefined; }
};
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
class SourceError extends Error {
  constructor(reason, retryAt) { super(reason); this.reason = reason; this.retryAt = retryAt; }
}
export function mediaFromStatus(post, username, userId) {
  if (post?.type !== 'status' || !/^\d+$/.test(post.id ?? '') || post.author?.id !== userId ||
      post.author?.screen_name?.toLowerCase() !== username || post.author.protected || post.reposted_by) return [];
  const date = new Date(typeof post.created_timestamp === 'number' ? post.created_timestamp * 1000 : post.created_at);
  if (!Number.isFinite(date.getTime()) || !Array.isArray(post.media?.all)) return [];
  return post.media.all.flatMap((raw, index) => {
    if (!['photo', 'video', 'gif', 'animated_gif'].includes(raw?.type)) return [];
    const type = raw.type === 'gif' ? 'animated_gif' : raw.type;
    const mediaKey = typeof raw.id === 'string' && raw.id ? raw.id : `${post.id}-${index}`;
    const url = safeUrl(raw.url), previewImageUrl = safeUrl(raw.thumbnail_url);
    const variants = (Array.isArray(raw.formats) ? raw.formats : []).flatMap((v) => {
      const url = safeUrl(v?.url);
      return url && /\.mp4(?:\?|$)/i.test(url) ? [{ url, contentType: 'video/mp4', bitRate: number(v.bitrate) }] : [];
    });
    if (type !== 'photo' && url && /\.mp4(?:\?|$)/i.test(url) && !variants.some(v => v.url === url)) variants.push({ url, contentType: 'video/mp4' });
    if (type === 'photo' ? !url : !variants.length && !previewImageUrl) return [];
    return [{ id: `${post.id}:${mediaKey}`, postId: post.id, postUrl: `https://x.com/${username}/status/${post.id}`,
      postText: typeof post.text === 'string' ? post.text : '', createdAt: date.toISOString(),
      media: { mediaKey, type, ...(type === 'photo' ? { url } : { previewImageUrl }),
        width: number(raw.width), height: number(raw.height), durationMs: number(raw.duration) === undefined ? undefined : raw.duration * 1000,
        altText: typeof raw.alt_text === 'string' ? raw.alt_text : undefined, variants },
    }];
  });
}

export async function collectFxMedia(username, maxPosts, resume, dependencies = {}) {
  const emit = dependencies.emit ?? (async (event) => { if (!process.stdout.write(JSON.stringify(event) + '\n')) await once(process.stdout, 'drain'); });
  const fetchPublic = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  const seen = new Set(resume?.seenPostIds ?? []), cursors = new Set(resume?.cursor ? [resume.cursor] : []);
  let cursor = resume?.cursor, profile = resume, batchesRead = resume?.batchesRead ?? 0;
  let reason = 'exhausted', retryAt;
  const get = async (path) => {
    const response = await fetchPublic(`https://api.fxtwitter.com/2/${path}`, {
      signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store',
      headers: { 'User-Agent': 'X Media/0.1 (local public media archive)', Accept: 'application/json' },
    });
    if (response.status === 429) {
      const after = response.headers.get('retry-after');
      const reset = response.headers.get('x-ratelimit-reset') ?? response.headers.get('x-rate-limit-reset');
      const parsed = after ? (/^\d+$/.test(after) ? Date.now() + Number(after) * 1000 : Date.parse(after)) : Number(reset) * 1000;
      throw new SourceError('rate_limit', Number.isFinite(parsed) && parsed > Date.now() ? parsed : undefined);
    }
    if (![200, 404].includes(response.status)) throw new SourceError('upstream');
    const body = await response.text();
    if (body.length > 8000000) throw new SourceError('upstream');
    const data = JSON.parse(body);
    if (![200, 404].includes(data.code)) throw new SourceError(data.code === 429 ? 'rate_limit' : 'upstream');
    return data;
  };
  try {
    if (!/^[a-z0-9_]{1,15}$/.test(username) || (resume && (resume.username !== username || resume.provider !== 'fxtwitter'))) throw new SourceError('unavailable');
    const readPage = async (nextCursor) => {
      const query = new URLSearchParams({ count: String(Math.min(100, maxPosts - seen.size)) });
      if (nextCursor) query.set('cursor', nextCursor);
      const data = await get(`profile/${username}/media?${query}`);
      if (data.code === 404) throw new SourceError('unavailable');
      if (!Array.isArray(data.results) || !data.cursor || !('bottom' in data.cursor)) throw new SourceError('upstream');
      return data;
    };
    let firstPage;
    if (!profile) {
      // The media response already carries the author's profile. Avoid a serial lookup
      // on the critical path; empty timelines still resolve the profile explicitly.
      firstPage = await readPage();
      const author = firstPage.results.find(post => post?.type === 'status' && !post.reposted_by && post.author?.screen_name?.toLowerCase() === username)?.author;
      const user = author ?? (await get(`profile/${username}`)).user;
      if (user?.protected || user?.screen_name?.toLowerCase() !== username || typeof user?.id !== 'string' || !/^\d+$/.test(user.id)) throw new SourceError('unavailable');
      profile = { username, userId: user.id, displayName: typeof user.name === 'string' ? user.name : username, profileImageUrl: safeUrl(user.avatar_url) };
    }
    await emit({ type: 'profile', username, displayName: profile.displayName, profileImageUrl: profile.profileImageUrl });
    for (let page = 0; page < 3; page++) {
      if (seen.size >= maxPosts) { reason = 'limit'; break; }
      const data = firstPage ?? await readPage(cursor);
      firstPage = undefined;
      if (!data.results.length) break;
      const items = []; let discovered = 0;
      for (const post of data.results) {
        if (typeof post?.id !== 'string' || !/^\d+$/.test(post.id) || seen.has(post.id)) continue;
        seen.add(post.id); discovered++;
        items.push(...mediaFromStatus(post, username, profile.userId));
        if (seen.size >= maxPosts) break;
      }
      batchesRead++;
      await emit({ type: 'batch', items, postsScanned: seen.size, batchesRead });
      if (seen.size >= maxPosts) { reason = 'limit'; break; }
      const next = data.cursor.bottom;
      if (!next) break;
      if (!discovered || typeof next !== 'string' || cursors.has(next)) { reason = 'repeated'; break; }
      cursors.add(next); cursor = next;
      await emit({ type: 'checkpoint', checkpoint: { provider: 'fxtwitter', ...profile, cursor, seenPostIds: [...seen], batchesRead } });
      if (page === 2) { reason = 'yield'; break; }
      await sleep(100);
    }
  } catch (error) {
    reason = error instanceof SourceError ? error.reason : error?.name === 'TimeoutError' ? 'timeout' : 'upstream';
    retryAt = error.retryAt;
  }
  await emit({ type: 'done', reason, retryAt });
}
