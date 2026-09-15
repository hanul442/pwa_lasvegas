import test from 'node:test';
import assert from 'node:assert/strict';
import { blackjackActionFingerprint, blackjackStartFingerprint, findBlackjackStartReplay, isBlackjackCommandReplay, recordBlackjackCommand, tagBlackjackStart } from '../lib/blackjack-idempotency.mjs';

test('blackjack start retries find the original round even after settlement',()=>{
  const fingerprint=blackjackStartFingerprint({engineVersion:'MULTI_SPOT_V2',stake:1_000_000,spots:2,floor:'strip'});
  const round={id:'bj2_1',game:'Blackjack',engineVersion:'MULTI_SPOT_V2',userId:'hanseo',status:'SETTLED'};
  tagBlackjackStart(round,'req-start-0001',fingerprint);
  const state={rounds:[round]};
  assert.equal(findBlackjackStartReplay(state,{userId:'hanseo',key:'req-start-0001',fingerprint,engineVersion:'MULTI_SPOT_V2'}),round);
});

test('reused blackjack start key with changed parameters fails closed',()=>{
  const original=blackjackStartFingerprint({engineVersion:'MULTI_SPOT_V2',stake:1_000_000,spots:1,floor:'strip'});
  const changed=blackjackStartFingerprint({engineVersion:'MULTI_SPOT_V2',stake:3_000_000,spots:1,floor:'strip'});
  const round={id:'bj2_1',game:'Blackjack',engineVersion:'MULTI_SPOT_V2',userId:'hanseo'};
  tagBlackjackStart(round,'req-start-0002',original);
  assert.throws(()=>findBlackjackStartReplay({rounds:[round]},{userId:'hanseo',key:'req-start-0002',fingerprint:changed,engineVersion:'MULTI_SPOT_V2'}),/IDEMPOTENCY_CONFLICT/);
});

test('same blackjack action key is replayed without executing the action twice',()=>{
  const round={id:'bj2_2',game:'Blackjack',engineVersion:'MULTI_SPOT_V2',idempotency:{commands:[]}};
  const fingerprint=blackjackActionFingerprint({engineVersion:'MULTI_SPOT_V2',roundId:round.id,handIndex:0,action:'HIT'});
  assert.equal(isBlackjackCommandReplay(round,'req-action-001',fingerprint),false);
  recordBlackjackCommand(round,'req-action-001',fingerprint);
  assert.equal(isBlackjackCommandReplay(round,'req-action-001',fingerprint),true);
  assert.equal(round.idempotency.commands.length,1);
  recordBlackjackCommand(round,'req-action-001',fingerprint);
  assert.equal(round.idempotency.commands.length,1);
});

test('same blackjack action key with another command conflicts',()=>{
  const round={id:'bj2_3',game:'Blackjack',engineVersion:'MULTI_SPOT_V2'};
  const hit=blackjackActionFingerprint({engineVersion:'MULTI_SPOT_V2',roundId:round.id,handIndex:0,action:'HIT'});
  const stand=blackjackActionFingerprint({engineVersion:'MULTI_SPOT_V2',roundId:round.id,handIndex:0,action:'STAND'});
  recordBlackjackCommand(round,'req-action-002',hit);
  assert.throws(()=>isBlackjackCommandReplay(round,'req-action-002',stand),/IDEMPOTENCY_CONFLICT/);
});
