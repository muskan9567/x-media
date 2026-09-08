import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { VISION_MODEL,VISION_VERSION } from './vision.mjs';
import { RANK_VERSION } from './ranking.mjs';

export const DEFAULT_SETTINGS = Object.freeze({ tvSeconds: 8, diskCacheMB: 2048, visionEnabled: false,
  visionInfluence: false, dailyBudget: 1, monthlyBudget: 10, dailyImages: 100, discordEnabled: false });

export function mergePost(old = {}, incoming = {}) {
  old ||= {};
  const next = { ...old };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && value !== '') next[key] = value;
    else if (!(key in next)) next[key] = value;
  }
  next.discoveredAt = old.discoveredAt || incoming.discoveredAt || new Date().toISOString();
  next.removed = Boolean(old.removed || incoming.removed);
  next.provenance = [...new Set([...(old.provenance || []), ...(incoming.provenance || []), incoming.discoverySource].filter(Boolean))];
  if (old.imageUrl && incoming.imageUrl && old.imageUrl !== incoming.imageUrl) {
    for (const key of ['asset', 'assetVerified', 'assetQualityScore', 'assetSignals', 'assetWarnings', 'assetCheckedAt', 'assetRetryAt', 'unavailable', 'analysis', 'duplicateOf']) delete next[key];
  }
  return next;
}

export class Store {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(path.join(directory, 'runtime'), { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'runtime', 'finder.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,body TEXT NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,verdict TEXT NOT NULL,source TEXT NOT NULL,reason TEXT,at INTEGER NOT NULL,favorite INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS feedback(event_id TEXT PRIMARY KEY,post_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT,at INTEGER NOT NULL,previous TEXT,undone INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS feedback_post ON feedback(post_id,at);
      CREATE TABLE IF NOT EXISTS seen(id TEXT PRIMARY KEY,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,ids TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS analyses(key TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(url TEXT PRIMARY KEY,hash TEXT NOT NULL,type TEXT NOT NULL,bytes INTEGER NOT NULL,accessed INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS assets_hash ON assets(hash);
      CREATE TABLE IF NOT EXISTS spending(id TEXT PRIMARY KEY,at INTEGER NOT NULL,cost REAL NOT NULL,state TEXT NOT NULL,post_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS spending_at ON spending(at);`);
    this.migrate();
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  meta(key, value) {
    if (value !== undefined) this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, JSON.stringify(value));
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : undefined;
  }
  migrate() {
    if (this.meta('migration-v4')) return;
    const read = (name, fallback) => {
      const file = path.join(this.directory, name);
      if (!existsSync(file)) return fallback;
      try { return JSON.parse(readFileSync(file, 'utf8')); }
      catch { throw new Error(`Cannot import ${name}: invalid JSON. Original data was preserved.`); }
    };
    const posts = read('pool-cache.json', []), reviews = read('meme-reviews.json', {});
    if (!Array.isArray(posts) || !reviews || Array.isArray(reviews) || typeof reviews !== 'object') throw Error('Invalid legacy data; migration stopped.');
    const backup = path.join(this.directory, 'runtime', 'migration-v4-backup');
    mkdirSync(backup, { recursive: true });
    for (const name of ['pool-cache.json', 'meme-reviews.json']) {
      if (existsSync(path.join(this.directory, name))) copyFileSync(path.join(this.directory, name), path.join(backup, name));
    }
    this.transaction(() => {
      posts.forEach(post => { if (post?.id) this.putPost(post); });
      for (const [id, review] of Object.entries(reviews)) {
        if (review.meme?.id && !this.getPost(id)) this.putPost(review.meme);
        const source = review.source === 'manual' ? 'manual' : review.source?.startsWith('automatic') ? 'automatic' : 'legacy_unknown';
        const at = typeof review.at === 'number' ? review.at : Date.parse(review.at) || Date.now();
        this.db.prepare('INSERT OR IGNORE INTO reviews(id,verdict,source,at) VALUES(?,?,?,?)').run(id, review.verdict || 'unreviewed', source, at);
      }
      this.meta('migration-v4', { at: Date.now(), posts: posts.length, reviews: Object.keys(reviews).length, backup });
    });
  }
  getPost(id) { const row = this.db.prepare('SELECT body FROM posts WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; }
  posts() { return this.db.prepare('SELECT body FROM posts ORDER BY id').all().map(row => JSON.parse(row.body)); }
  putPost(post) {
    const merged = mergePost(this.getPost(post.id), post);
    this.db.prepare('INSERT OR REPLACE INTO posts VALUES(?,?,?)').run(merged.id, JSON.stringify(merged), Date.now());
    return merged;
  }
  review(id) { return this.db.prepare('SELECT * FROM reviews WHERE id=?').get(id) || null; }
  reviews() { return Object.fromEntries(this.db.prepare('SELECT * FROM reviews').all().map(row => [row.id, row])); }
  autoKeep(id) {
    this.db.prepare("INSERT OR IGNORE INTO reviews(id,verdict,source,at) VALUES(?,'keep','automatic',?)").run(id, Date.now());
  }
  feedback(id, action, reason = null) {
    if (!['keep', 'favorite', 'unfavorite', 'reject', 'clear'].includes(action)) throw Error('Invalid feedback action');
    if (reason && !['not_funny', 'off_topic', 'seen', 'unreadable'].includes(reason)) throw Error('Invalid rejection reason');
    if (!this.getPost(id)) throw Error('Meme not found');
    return this.transaction(() => {
      const previous = this.review(id), eventId = randomUUID(), at = Date.now();
      const verdict = action === 'reject' ? 'reject' : action === 'clear' ? 'unreviewed' : 'keep';
      const favorite = action === 'favorite' ? 1 : ['unfavorite', 'reject', 'clear'].includes(action) ? 0 : previous?.favorite || 0;
      this.db.prepare('INSERT OR REPLACE INTO reviews VALUES(?,?,?,?,?,?)').run(id, verdict, 'manual', action === 'reject' ? reason : null, at, favorite);
      this.db.prepare('INSERT INTO feedback(event_id,post_id,action,reason,at,previous) VALUES(?,?,?,?,?,?)')
        .run(eventId, id, action, reason, at, JSON.stringify(previous));
      return eventId;
    });
  }
  undo(eventId) {
    return this.transaction(() => {
      const event = this.db.prepare('SELECT * FROM feedback WHERE event_id=?').get(eventId);
      if (!event || event.undone) throw Error('Feedback already undone or unavailable');
      const latest = this.db.prepare('SELECT event_id FROM feedback WHERE post_id=? AND undone=0 ORDER BY rowid DESC LIMIT 1').get(event.post_id);
      if (latest?.event_id !== eventId) throw Error('Undo the most recent change to this meme first');
      const old = JSON.parse(event.previous);
      if (old) this.db.prepare('INSERT OR REPLACE INTO reviews VALUES(?,?,?,?,?,?)').run(old.id, old.verdict, old.source, old.reason, old.at, old.favorite);
      else this.db.prepare('DELETE FROM reviews WHERE id=?').run(event.post_id);
      this.db.prepare('UPDATE feedback SET undone=1 WHERE event_id=?').run(eventId);
      return event.post_id;
    });
  }
  tasteEvents() { return this.db.prepare('SELECT * FROM feedback WHERE undone=0 ORDER BY rowid').all(); }
  markSeen(id) { if (!this.getPost(id)) throw Error('Meme not found'); this.db.prepare('INSERT OR IGNORE INTO seen VALUES(?,?)').run(id, Date.now()); }
  seen() { return new Set(this.db.prepare('SELECT id FROM seen').all().map(row => row.id)); }
  batch() { const row = this.db.prepare('SELECT * FROM batches ORDER BY at DESC,rowid DESC LIMIT 1').get(); return row ? { ...row, ids: JSON.parse(row.ids) } : null; }
  saveBatch(ids) { const batch = { id: randomUUID(), ids, at: Date.now() }; this.db.prepare('INSERT INTO batches VALUES(?,?,?)').run(batch.id, JSON.stringify(ids), batch.at); return batch; }
  visionValidated(){const report=this.meta('vision-validated');return Boolean(report?.passed&&report.model===VISION_MODEL&&report.version===VISION_VERSION&&report.rankVersion===RANK_VERSION);}
  settings(patch) {
    const current = { ...DEFAULT_SETTINGS, ...this.meta('settings') };
    if(current.visionInfluence&&!this.visionValidated())current.visionInfluence=false;
    if (!patch) return current;
    const limits = { tvSeconds: [5, 30], diskCacheMB: [64, 16384], dailyBudget: [0, 100], monthlyBudget: [0, 1000], dailyImages: [1, 1000] };
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(DEFAULT_SETTINGS,key)) throw Error('Unknown setting: ' + key);
      if (key in limits) { if (!Number.isFinite(value) || value < limits[key][0] || value > limits[key][1]) throw Error('Invalid setting: ' + key); }
      else if (typeof value !== 'boolean') throw Error('Invalid setting: ' + key);
    }
    if (patch.visionInfluence && !this.visionValidated()) throw Error('Image ranking must pass its held-out evaluation before activation. Shadow analysis is available.');
    const settings = { ...current, ...patch }; this.meta('settings', settings); return settings;
  }
  job(id, body) { if (body) this.db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?)').run(id, JSON.stringify(body)); const row = this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; }
  jobs() { return this.db.prepare('SELECT id,body FROM jobs').all().map(row => ({ id: row.id, ...JSON.parse(row.body) })); }
  analysis(key, body) { if (body) this.db.prepare('INSERT OR REPLACE INTO analyses VALUES(?,?)').run(key, JSON.stringify(body)); const row = this.db.prepare('SELECT body FROM analyses WHERE key=?').get(key); return row ? JSON.parse(row.body) : null; }
  asset(url, entry) {
    if (entry) this.db.prepare('INSERT OR REPLACE INTO assets VALUES(?,?,?,?,?)').run(url, entry.hash, entry.type, entry.bytes, Date.now());
    const row = this.db.prepare('SELECT * FROM assets WHERE url=?').get(url);
    if (row) this.db.prepare('UPDATE assets SET accessed=? WHERE url=?').run(Date.now(), url);
    return row || null;
  }
  spending(now = Date.now()) {
    const d = new Date(now), day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const rows = this.db.prepare('SELECT * FROM spending WHERE at>=?').all(month);
    return { daily: rows.filter(r => r.at >= day).reduce((a,r) => a+r.cost,0), monthly: rows.reduce((a,r) => a+r.cost,0), imagesToday: rows.filter(r => r.at >= day).length, timezone: 'UTC' };
  }
  reserve(postId, cost, now = Date.now()) {
    if (!(cost > 0 && Number.isFinite(cost))) return null;
    return this.transaction(() => {
      const s = this.settings(), used = this.spending(now);
      if (!s.visionEnabled || used.daily + cost > s.dailyBudget || used.monthly + cost > s.monthlyBudget || used.imagesToday >= s.dailyImages) return null;
      const id = randomUUID(); this.db.prepare('INSERT INTO spending VALUES(?,?,?,?,?)').run(id, now, cost, 'reserved', postId); return id;
    });
  }
  settle(id, cost) { if (Number.isFinite(cost) && cost >= 0) this.db.prepare("UPDATE spending SET cost=?,state='complete' WHERE id=?").run(cost, id); }
  close() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); }
}
