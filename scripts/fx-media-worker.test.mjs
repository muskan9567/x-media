import { describe, expect, it, vi } from 'vitest';
import { collectFxMedia, mediaFromStatus } from './fx-media-worker.mjs';
const profile = { id: '123', screen_name: 'ordinary', name: 'Ordinary', protected: false, avatar_url: 'https://pbs.twimg.com/avatar.jpg' };
const post = (id, type = 'video') => ({ type: 'status', id, author: profile, text: 'Public media', created_timestamp: 1788220800,
  media: { all: [{ id: `${id}00`, type, url: type === 'photo' ? 'https://pbs.twimg.com/image.jpg' : 'https://video.twimg.com/video.mp4', thumbnail_url: 'https://pbs.twimg.com/thumb.jpg', duration: 2.5,
    formats: [{ url: 'https://video.twimg.com/high.mp4', bitrate: 2000000 }, { url: 'https://video.twimg.com/video.m3u8' }] }] } });
const page = (posts, cursor = null) => ({ code: 200, results: posts, cursor: { bottom: cursor, top: null } });
function harness(pages, user = profile) {
  const events = [], calls = [];
  const fetch = vi.fn(async (url, options) => {
    calls.push({ url, options });
    if (!url.includes('/media?')) return Response.json({ code: user ? 200 : 404, user });
    const cursor = new URL(url).searchParams.get('cursor') ?? 'first';
    const data = pages[cursor] ?? page([]);
    if (data instanceof Error) throw data;
    return data instanceof Response ? data : Response.json(data);
  });
  return { events, calls, dependencies: { fetch, sleep: async () => {}, emit: async e => events.push(e) } };
}
describe('public media timeline source', () => {
  it('collects ordinary handles with photos, GIFs and the highest MP4 variants without credentials', async () => {
    const h = harness({ first: page([post('1'), post('2', 'photo'), post('3', 'gif')], 'next') });
    await collectFxMedia('ordinary', 10000, null, h.dependencies);
    const items = h.events.flatMap(e => e.items ?? []);
    expect(items.map(i => i.media.type)).toEqual(['video', 'photo', 'animated_gif']);
    expect(items[0].media.variants).toHaveLength(2); expect(items[0].media.durationMs).toBe(2500);
    expect(items[0].id).toBe('1:100'); expect(h.events.at(-1).reason).toBe('exhausted');
    expect(h.calls.every(c => !('Authorization' in c.options.headers) && !('Cookie' in c.options.headers))).toBe(true);
    expect(h.calls).toHaveLength(2);
    expect(h.calls.every(c => c.url.includes('/media?'))).toBe(true);
  });
  it('persists the next page and resumes after yielding without duplicate media or a repeated profile lookup', async () => {
    const h = harness({ first: page([post('1')], 'two'), two: page([post('2')], 'three'), three: page([post('3')], 'four') });
    await collectFxMedia('ordinary', 10000, null, h.dependencies);
    expect(h.events.at(-1).reason).toBe('yield');
    const checkpoint = h.events.filter(e => e.type === 'checkpoint').at(-1).checkpoint;
    expect(checkpoint).toMatchObject({ provider: 'fxtwitter', cursor: 'four', seenPostIds: ['1', '2', '3'] });
    expect(h.events.map(e => e.type)).toEqual(['profile', 'batch', 'checkpoint', 'batch', 'checkpoint', 'batch', 'checkpoint', 'done']);
    const next = harness({ four: page([post('3'), post('4')]) });
    await collectFxMedia('ordinary', 10000, checkpoint, next.dependencies);
    expect(next.calls).toHaveLength(1); expect(next.calls[0].url).toContain('cursor=four');
    expect(next.events.flatMap(e => e.items ?? []).map(i => i.postId)).toEqual(['4']);
    expect(next.events.find(e => e.type === 'batch').postsScanned).toBe(4);
  });
  it('keeps collected pages on rate limits and stops repeated pages', async () => {
    const limited = harness({ first: page([post('1')], 'two'), two: new Response(null, { status: 429, headers: { 'Retry-After': '60' } }) });
    await collectFxMedia('ordinary', 10000, null, limited.dependencies);
    expect(limited.events.at(-1).reason).toBe('rate_limit');
    expect(limited.events.at(-1).retryAt).toBeGreaterThan(Date.now() + 55000);
    expect(limited.events.flatMap(e => e.items ?? [])).toHaveLength(1);
    const repeated = harness({ first: page([post('1')], 'same'), same: page([post('1')], 'another') });
    await collectFxMedia('ordinary', 10000, null, repeated.dependencies);
    expect(repeated.events.at(-1).reason).toBe('repeated'); expect(repeated.calls).toHaveLength(2);
  });
  it('checks empty timelines against the profile and rejects private, missing and mismatched identities', async () => {
    for (const user of [null, { ...profile, protected: true }, { ...profile, screen_name: 'someoneelse' }]) {
      const h = harness({}, user); await collectFxMedia('ordinary', 10000, null, h.dependencies);
      expect(h.calls).toHaveLength(2); expect(h.events.at(-1).reason).toBe('unavailable');
    }
    expect(mediaFromStatus({ ...post('1'), author: { ...profile, id: '456' } }, 'ordinary', '123')).toEqual([]);
    expect(mediaFromStatus({ ...post('1'), reposted_by: profile }, 'ordinary', '123')).toEqual([]);
  });
  it('rejects inaccessible media and private authors without another lookup', async () => {
    const missing = harness({ first: { code: 404 } });
    await collectFxMedia('ordinary', 10000, null, missing.dependencies);
    expect(missing.events.at(-1).reason).toBe('unavailable'); expect(missing.calls).toHaveLength(1);
    const privatePost = { ...post('1'), author: { ...profile, protected: true } };
    const hidden = harness({ first: page([privatePost]) });
    await collectFxMedia('ordinary', 10000, null, hidden.dependencies);
    expect(hidden.events.at(-1).reason).toBe('unavailable');
    expect(hidden.events.flatMap(e => e.items ?? [])).toHaveLength(0);
  });
  it('does not accept remote URLs outside the media CDN or invalid timestamps', () => {
    const unsafe = post('1'); unsafe.media.all[0].url = 'http://localhost/private'; unsafe.media.all[0].thumbnail_url = 'https://evil.test/a'; unsafe.media.all[0].formats = [];
    expect(mediaFromStatus(unsafe, 'ordinary', '123')).toEqual([]);
    expect(mediaFromStatus({ ...post('1'), created_timestamp: NaN }, 'ordinary', '123')).toEqual([]);
  });
  it('reports malformed responses and failures as errors instead of empty successful archives', async () => {
    for (const data of [new Response('not json'), { code: 200, unexpected: [] }, new Response(null, { status: 503 }), new DOMException('Timed out', 'TimeoutError')]) {
      const h = harness({ first: data }); await collectFxMedia('ordinary', 10000, null, h.dependencies);
      expect(['upstream', 'timeout']).toContain(h.events.at(-1).reason);
    }
  });
  it('honors the post cap and refuses invalid handles and foreign checkpoints', async () => {
    const h = harness({ first: page([post('1'), post('2')], 'next') });
    await collectFxMedia('ordinary', 1, null, h.dependencies);
    expect(h.events.flatMap(e => e.items ?? [])).toHaveLength(1); expect(h.events.at(-1).reason).toBe('limit');
    const invalid = harness({}); await collectFxMedia('../escape', 10000, null, invalid.dependencies);
    await collectFxMedia('ordinary', 10000, { provider: 'guest', username: 'foreign' }, invalid.dependencies);
    expect(invalid.calls).toHaveLength(0);
  });
});
