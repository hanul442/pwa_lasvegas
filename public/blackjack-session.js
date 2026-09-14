const PREFIX='sv-bjv2-session:';

export function blackjackSessionKey(playerId){
  return `${PREFIX}${String(playerId||'guest')}`;
}

function validRound(round){
  return Boolean(
    round &&
    typeof round==='object' &&
    typeof round.id==='string' &&
    round.engineVersion==='MULTI_SPOT_V2' &&
    round.status==='PLAYER' &&
    Number.isInteger(round.activeHand) &&
    Array.isArray(round.hands) &&
    round.hands.length>0
  );
}

export function saveBlackjackSession(storage,playerId,round){
  if(!storage||!validRound(round)) return false;
  try{
    storage.setItem(blackjackSessionKey(playerId),JSON.stringify({round,updatedAt:Date.now()}));
    return true;
  }catch{return false;}
}

export function loadBlackjackSession(storage,playerId,maxAgeMs=6*60*60*1000){
  if(!storage) return null;
  try{
    const raw=storage.getItem(blackjackSessionKey(playerId));
    if(!raw) return null;
    const parsed=JSON.parse(raw);
    if(!parsed||!validRound(parsed.round)||!Number.isFinite(parsed.updatedAt)||Date.now()-parsed.updatedAt>maxAgeMs){
      storage.removeItem(blackjackSessionKey(playerId));
      return null;
    }
    return parsed.round;
  }catch{
    try{storage.removeItem(blackjackSessionKey(playerId));}catch{}
    return null;
  }
}

export function clearBlackjackSession(storage,playerId){
  if(!storage) return;
  try{storage.removeItem(blackjackSessionKey(playerId));}catch{}
}
