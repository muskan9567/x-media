import { rankPost,RANK_VERSION } from './ranking.mjs';
import { VISION_MODEL,VISION_VERSION } from './vision.mjs';

// A frozen, human-labelled holdout is required. Training feedback is not a gold label.
export function evaluateHoldout(records){
  const errors=[],hashes=new Set(),sources=new Set();let positives=0,negatives=0,tp=0,fp=0,fn=0,tn=0,sCount=0,sCorrect=0;
  for(const row of records){
    if(row.labelSource!=='human'||row.split!=='holdout'||typeof row.acceptable!=='boolean'){errors.push('Every row needs an explicit human holdout label.');continue;}
    if(!row.post?.asset?.sha256||hashes.has(row.post.asset.sha256)){errors.push('Holdout images must have unique verified content hashes.');continue;}
    hashes.add(row.post.asset.sha256);sources.add(row.post.subreddit);
    if(row.analysis?.status!=='complete'||row.analysis.model!==VISION_MODEL||row.analysis.version!==VISION_VERSION){errors.push('Every holdout image needs a completed assessment from the pinned model and prompt.');continue;}
    const ranked=rankPost(row.post,{analysis:row.analysis,useVision:true});
    if(row.acceptable){positives++;if(ranked.eligible)tp++;else fn++;}else{negatives++;if(ranked.eligible)fp++;else tn++;}
    if(ranked.tier==='S'&&ranked.eligible){sCount++;if(row.acceptable)sCorrect++;}
  }
  if(positives<20||negatives<20)errors.push('Label at least 20 good memes and 20 bad/non-memes.');
  if(sources.size<3)errors.push('Use at least three communities.');
  const precision=tp+fp?tp/(tp+fp):0,recall=positives?tp/positives:0,falsePositiveRate=negatives?fp/negatives:1;
  if(tp+fp<20||precision<.8)errors.push('At least 20 predicted picks with 80% precision are required.');
  if(recall<.6)errors.push('Recall must reach 60%.');
  if(falsePositiveRate>.1)errors.push('False-positive rate must be at most 10%.');
  if(sCount&&sCorrect/sCount<.9)errors.push('S-tier precision must reach 90% when S picks are predicted.');
  return {passed:errors.length===0,errors:[...new Set(errors)],n:records.length,positives,negatives,tp,fp,fn,tn,precision,recall,falsePositiveRate,sCount,sPrecision:sCount?sCorrect/sCount:null,
    model:VISION_MODEL,version:VISION_VERSION,rankVersion:RANK_VERSION,at:Date.now(),note:'Stratified human holdout; live user satisfaction must still be measured.'};
}
