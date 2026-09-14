export function activeBlackjackV2Round(state,userId){
  if(!state||!Array.isArray(state.rounds)||typeof userId!=='string')return null;
  return state.rounds.find(round=>
    round &&
    round.userId===userId &&
    round.game==='Blackjack' &&
    round.engineVersion==='MULTI_SPOT_V2' &&
    round.status!=='SETTLED'
  )||null;
}
