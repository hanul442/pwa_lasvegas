export function blackjackStartFingerprint({engineVersion,stake,spots=1,floor='strip'}){
  return JSON.stringify({
    kind:'START',
    engineVersion:String(engineVersion||''),
    stake:Number(stake),
    spots:Number(spots),
    floor:String(floor||'strip')
  });
}

export function blackjackActionFingerprint({engineVersion,roundId,handIndex=null,action}){
  return JSON.stringify({
    kind:'ACTION',
    engineVersion:String(engineVersion||''),
    roundId:String(roundId||''),
    handIndex:handIndex===undefined||handIndex===null?null:Number(handIndex),
    action:String(action||'')
  });
}

function sameOrConflict(record,fingerprint){
  if(!record)return false;
  if(record.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');
  return true;
}

export function findBlackjackStartReplay(state,{userId,key,fingerprint,engineVersion}){
  if(!key||!Array.isArray(state?.rounds))return null;
  for(let i=state.rounds.length-1;i>=0;i--){
    const round=state.rounds[i];
    if(round?.userId!==userId||round?.game!=='Blackjack'||round?.engineVersion!==engineVersion)continue;
    const record=round?.idempotency?.start;
    if(record?.key===key){sameOrConflict(record,fingerprint);return round;}
  }
  return null;
}

export function tagBlackjackStart(round,key,fingerprint){
  if(!key)return round;
  round.idempotency={...(round.idempotency||{}),start:{key,fingerprint},commands:[...(round.idempotency?.commands||[])]};
  return round;
}

export function isBlackjackCommandReplay(round,key,fingerprint){
  if(!key)return false;
  const commands=Array.isArray(round?.idempotency?.commands)?round.idempotency.commands:[];
  const record=commands.find(item=>item?.key===key);
  return sameOrConflict(record,fingerprint);
}

export function recordBlackjackCommand(round,key,fingerprint){
  if(!key)return round;
  const current=round.idempotency||{};
  const commands=Array.isArray(current.commands)?current.commands:[];
  const existing=commands.find(item=>item?.key===key);
  if(existing){sameOrConflict(existing,fingerprint);return round;}
  round.idempotency={...current,commands:[...commands,{key,fingerprint}]};
  return round;
}
