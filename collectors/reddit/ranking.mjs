import { evaluateMeme } from './meme-quality.mjs';
import { matchingAiCodingTopics, topicText } from './topic-filter.mjs';

export const RANK_VERSION = '4.0';
const DAY = 86400_000;
export const postedAt = p => Number(p.created) > 1e10 ? Number(p.created) : Number(p.created) * 1000;
const clamp = (x,a=0,b=100) => Math.max(a,Math.min(b,x));

export function rankPost(post, { population = [], analysis = null, now = Date.now(), useVision = false, evidence = null } = {}) {
  const old = evidence || evaluateMeme(post), title = topicText(post.title);
  const signals = old.qualitySignals;
  const source = signals.some(s => s.startsWith('meme-focused source'));
  const phrase = signals.some(s => /strong meme phrasing|reaction\/punchline/.test(s));
  const flair = signals.some(s => s.startsWith('meme flair'));
  const editorial = old.qualityWarnings.some(s => /news|support|self-promotion/.test(s)) && !phrase;
  const content = phrase ? (source || flair ? 88 : 75) : source && flair ? 72 : source ? 64 : flair ? 54 : 20;
  const confidence = phrase && (source || flair) ? .9 : source && flair ? .78 : phrase || source ? .65 : .4;
  const peers = population.filter(p => p.subreddit === post.subreddit && Number.isFinite(p.score));
  const percentile = peers.length >= 5 && Number.isFinite(post.score) ? peers.filter(p=>p.score <= post.score).length/peers.length : .5;
  const approval = Number.isFinite(post.upvoteRatio) ? clamp((post.upvoteRatio-.5)*2,0,1) : .5;
  const engagement = Number.isFinite(post.score) ? clamp(Math.log10(Math.max(0,post.score)+1)*18 + percentile*15 + approval*10) : 35;
  const visuallyJudged = useVision && analysis?.status === 'complete';
  const humor = visuallyJudged ? analysis.humor : content;
  const confidenceValue = visuallyJudged ? analysis.confidence : confidence;
  const relevant = visuallyJudged ? analysis.topicRelevant : old.topicRelevant;
  const usable = Boolean(post.imageUrl && post.assetVerified && post.assetQualityScore >= 65 && !post.unavailable);
  let quality = Math.round(.8*humor + .2*engagement);
  if (editorial && !visuallyJudged) quality = Math.min(quality,45);
  if (!Number.isFinite(post.score) || post.score < 25) quality = Math.min(quality,69);
  if (!visuallyJudged && !(phrase && (source || flair))) quality = Math.min(quality,85);
  const isMeme = Boolean(usable && relevant && (visuallyJudged ? analysis.isMeme && analysis.readability >= 60 : old.isMeme && !editorial));
  const tier = visuallyJudged && humor >= 90 && analysis.readability >= 80 && quality >= 88 && confidenceValue >= .85 && engagement >= 60 ? 'S' : quality >= 72 ? 'A' : 'B';
  const tags = [...new Set([...matchingAiCodingTopics(post.title), ...(analysis?.tags || [])])].slice(0,8);
  const format = analysis?.format || (/starter ?pack/.test(title) ? 'starter-pack' : /be like|when|pov/.test(title) ? 'reaction' : 'image-meme');
  const eligible = isMeme && quality >= 72 && confidenceValue >= .65 && post.assetQualityScore >= 80;
  const age = post.created ? (now-postedAt(post))/DAY : null;
  return { ...post, qualityScore: clamp(quality), tier, isMeme, eligible, confidence: confidenceValue, topicRelevant: relevant,
    analysisStatus: analysis?.status || 'not-analyzed', analysis, tags, format, rankVersion: RANK_VERSION, rankingSource:visuallyJudged?'image':'post',
    scores: { humor, engagement: Math.round(engagement), readability: visuallyJudged ? analysis.readability : post.assetQualityScore || 0 },
    reasons: [age !== null && age >= 0 && age <= 2 ? 'New AI and coding humor' : 'AI and coding humor',
      engagement >= 70 ? 'Popular in its community' : 'Matched to the topic', visuallyJudged ? 'Image analyzed' : 'Ranked from post signals'],
    qualitySignals: signals, qualityWarnings: old.qualityWarnings };
}

export function tasteProfile(events, posts) {
  const byId = new Map(posts.map(p=>[p.id,p])), latest = new Map();
  for (const e of events) latest.set(e.post_id,e);
  const profile = new Map();
  for (const [id,e] of latest) {
    const p=byId.get(id); if (!p) continue;
    const weight = e.action === 'favorite' ? 2 : e.action === 'keep' ? 1 : e.action === 'reject' && e.reason === 'not_funny' ? -1 : 0;
    if (!weight) continue;
    for (const key of [`source:${p.subreddit}`,`format:${p.format}`,...(p.tags||[]).map(t=>'topic:'+t)]) {
      const old=profile.get(key)||{sum:0,count:0}; profile.set(key,{sum:old.sum+weight,count:old.count+1});
    }
  }
  return profile;
}

export function personalizedScore(post, profile, now=Date.now()) {
  const keys=[`source:${post.subreddit}`,`format:${post.format}`,...(post.tags||[]).map(t=>'topic:'+t)];
  const scores=keys.map(k=>profile.get(k)).filter(Boolean);
  const taste=scores.length ? clamp(scores.reduce((a,v)=>a+v.sum/(v.count+5),0)/scores.length*10,-10,10) : 0;
  const days=post.created ? (now-postedAt(post))/DAY : 30;
  const fresh=days>=0&&days<=7 ? 5*(1-days/7) : 0;
  return { score:post.qualityScore+taste+fresh, taste };
}

export function selectBatch(posts, {seen=new Set(),reviews={},profile=new Map(),now=Date.now(),limit=20}={}) {
  const remaining=posts.filter(p=>p.eligible&&!p.duplicateOf&&!p.removed&&!seen.has(p.id)&&reviews[p.id]?.verdict!=='reject'
    && p.created && now-postedAt(p)>=-300_000 && now-postedAt(p)<=30*DAY)
    .map(p=>({...p,personal:personalizedScore(p,profile,now)})).sort((a,b)=>b.personal.score-a.personal.score||b.created-a.created);
  const chosen=[],hashes=new Set(),topics=new Map();
  while(remaining.length&&chosen.length<limit) {
    let candidates=remaining.filter(p=>!p.asset?.sha256||!hashes.has(p.asset.sha256));
    if(!candidates.length) break;
    const last=chosen.at(-1);
    const diverse=candidates.filter(p=>p.subreddit!==last?.subreddit);
    if(diverse.length)candidates=diverse;
    candidates.sort((a,b)=> {
      const adjusted=p=>p.personal.score-(p.subreddit===last?.subreddit?12:0)-(topics.get(p.tags[0])||0)*4;
      return adjusted(b)-adjusted(a);
    });
    const next=candidates[0]; remaining.splice(remaining.indexOf(next),1); chosen.push(next);
    if(next.asset?.sha256) hashes.add(next.asset.sha256);
    if(next.tags[0]) topics.set(next.tags[0],(topics.get(next.tags[0])||0)+1);
  }
  return chosen;
}
