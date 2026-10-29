const KEY_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function normalizeIdempotencyKey(value){
  if(value===undefined||value===null||value==='')return null;
  if(Array.isArray(value))throw new Error('INVALID_IDEMPOTENCY_KEY');
  const key=String(value).trim();
  if(!KEY_RE.test(key))throw new Error('INVALID_IDEMPOTENCY_KEY');
  return key;
}

// `lightning` is only written when on, so plain-table fingerprints stay what they always were.
export function instantRequestFingerprint({game,stake,floor,betType,target=null,lightning=false}){
  return JSON.stringify({
    game:String(game||''),
    stake:Number(stake),
    floor:String(floor||'strip'),
    betType:String(betType||''),
    target:target===undefined||target===null?null:Number(target),
    ...(lightning?{lightning:true}:{})
  });
}

// The multi-spot roulette spin: a retry must name the same spots, stakes and table mode.
export function sicboRollFingerprint({floor,bets}){
  return JSON.stringify({game:'Sic Bo',floor,bets:bets.map(x=>[x.betType,x.target,x.stake])});
}
export function rouletteSpinFingerprint({floor,bets,lightning=false}){
  return JSON.stringify({game:'Roulette',floor,bets:bets.map(x=>[x.betType,x.target,x.stake]),...(lightning?{lightning:true}:{})});
}

function replayForKey(state,userId,key){
  if(!key||!Array.isArray(state?.rounds))return null;
  for(let i=state.rounds.length-1;i>=0;i--){
    const round=state.rounds[i];
    if(round?.userId===userId&&round?.idempotency?.key===key)return round;
  }
  return null;
}

export function instantPublicRound(round){
  const {userId,floor,status,createdAt,idempotency,...publicRound}=round;
  return publicRound;
}

export function idempotentInstantRound(state,{userId,game,key,fingerprint,create}){
  if(typeof create!=='function')throw new Error('INVALID_INSTANT_FACTORY');
  const replay=replayForKey(state,userId,key);
  if(replay){
    if(replay.game!==game||replay.idempotency.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');
    return {round:replay,replayed:true};
  }
  const round=create();
  if(!round||round.game!==game)throw new Error('INVALID_INSTANT_ROUND');
  if(key)round.idempotency={key,fingerprint};
  state.rounds.push(round);
  return {round,replayed:false};
}
