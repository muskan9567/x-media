import { describe, expect, it, vi } from 'vitest';
import { collectStream } from './stream-media-worker.mjs';

const tweet = (id, username = 'smallaccount') => ({ id, username, text: 'Public video', timestamp: 1788220800,
  photos: [], videos: [{ id: `media${id}`, url: 'https://video.twimg.com/video.mp4', preview: 'https://pbs.twimg.com/thumb.jpg' }] });
function harness(pages, profileError) {
  const events = [], calls = [];
  class FakeScraper {
    constructor(options) { this.options = options; }
    async getProfile() {
      if (profileError) throw profileError;
      return { username: 'smallaccount', userId: '123', name: 'Small Account' };
    }
    async *getTweetsByUserId(userId) {
      let cursor;
      for (let i = 0; i < 12; i++) {
        const url = new URL('https://api.x.com/graphql/query/UserTweets');
        url.searchParams.set('variables', JSON.stringify({ userId, count: 10000, cursor }));
        const response = await this.options.fetch(url.toString(), {});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data.tweets.length) break;
        for (const item of data.tweets) yield item;
        cursor = data.next;
      }
    }
  }
  const fetch = vi.fn(async (input) => {
    const url = new URL(input); calls.push(url);
    if (url.hostname === 'api.fxtwitter.com') return Response.json({ user: { screen_name: 'smallaccount', id: '123', name: 'Small Account', protected: false } });
    const cursor = JSON.parse(url.searchParams.get('variables')).cursor ?? 'first';
    const data = pages[cursor];
    if (data instanceof Response) return data;
    return Response.json(data ?? { tweets: [], next: null });
  });
  return { events, calls, dependencies: { Scraper: FakeScraper, fetch, sleep: async () => {}, emit: async (e) => events.push(e) } };
}
describe('anonymous streaming pagination', () => {
  it('saves each page before its cursor, yields fairly, and resumes without re-reading old pages', async () => {
    const first = harness({ first: { tweets: [tweet('1')], next: 'two' }, two: { tweets: [tweet('2')], next: 'three' }, three: { tweets: [tweet('3')], next: 'four' } });
    await collectStream('smallaccount', 10000, undefined, first.dependencies);
    expect(first.calls).toHaveLength(3);
    expect(first.events.at(-1).reason).toBe('yield');
    const checkpoint = first.events.filter(e => e.type === 'checkpoint').at(-1).checkpoint;
    expect(checkpoint).toMatchObject({ cursor: 'four', seenPostIds: ['1', '2', '3'], batchesRead: 3 });
    expect(first.events.map(e => e.type)).toEqual(['profile', 'batch', 'checkpoint', 'batch', 'checkpoint', 'batch', 'checkpoint', 'done']);
    const resumed = harness({ four: { tweets: [tweet('3'), tweet('4')], next: null } });
    await collectStream('smallaccount', 10000, checkpoint, resumed.dependencies);
    expect(resumed.calls).toHaveLength(1);
    expect(JSON.parse(resumed.calls[0].searchParams.get('variables'))).toMatchObject({ cursor: 'four', count: 20, userId: '123' });
    expect(resumed.events.find(e => e.type === 'batch')).toMatchObject({ postsScanned: 4, batchesRead: 4 });
    expect(resumed.events.flatMap(e => e.items ?? []).map(i => i.postId)).toEqual(['4']);
    expect(resumed.events.at(-1).reason).toBe('exhausted');
  });
  it('stops a repeated cursor before another request and retains discovered media', async () => {
    const h = harness({ first: { tweets: [tweet('1')], next: 'two' }, two: { tweets: [tweet('2')], next: 'two' } });
    await collectStream('smallaccount', 10000, undefined, h.dependencies);
    expect(h.calls).toHaveLength(2); expect(h.events.at(-1).reason).toBe('repeated');
    expect(h.events.flatMap(e => e.items ?? [])).toHaveLength(2);
  });
  it('keeps the failed-page cursor and the upstream retry time on a rate limit', async () => {
    const h = harness({ first: { tweets: [tweet('1')], next: 'two' }, two: new Response(null, { status: 429, headers: { 'retry-after': '900' } }) });
    await collectStream('smallaccount', 10000, undefined, h.dependencies);
    expect(h.events.at(-1)).toMatchObject({ reason: 'rate_limit' });
    expect(h.events.at(-1).retryAt).toBeGreaterThan(Date.now() + 890000);
    expect(h.events.find(e => e.type === 'checkpoint').checkpoint.cursor).toBe('two');
  });
  it('resolves an ordinary account through a public profile fallback', async () => {
    const h = harness({ first: { tweets: [tweet('1')], next: null } }, new Error('Guest profile lookup failed'));
    await collectStream('smallaccount', 10000, undefined, h.dependencies);
    expect(h.calls[0].hostname).toBe('api.fxtwitter.com');
    expect(h.events.flatMap(e => e.items ?? [])).toHaveLength(1);
  });
  it('does not mix foreign authors or accept a checkpoint for another account', async () => {
    const h = harness({ first: { tweets: [tweet('1', 'foreign'), tweet('2')], next: null } });
    await collectStream('smallaccount', 10000, undefined, h.dependencies);
    expect(h.events.flatMap(e => e.items ?? []).map(i => i.postId)).toEqual(['2']);
    const other = harness({});
    await collectStream('smallaccount', 10000, { username: 'other', userId: '456', cursor: 'two', seenPostIds: [], batchesRead: 0 }, other.dependencies);
    expect(other.events.at(-1).reason).toBe('unavailable'); expect(other.calls).toHaveLength(0);
  });
});
