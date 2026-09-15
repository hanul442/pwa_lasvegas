import test from 'node:test';
import assert from 'node:assert/strict';
import { idempotentInstantRound, instantPublicRound, instantRequestFingerprint, normalizeIdempotencyKey } from '../lib/instant-idempotency.mjs';

test('idempotency keys are optional but malformed supplied keys fail closed',()=>{
  assert.equal(normalizeIdempotencyKey(undefined),null);
  assert.equal(normalizeIdempotencyKey('req-12345678'),'req-12345678');
  assert.throws(()=>normalizeIdempotencyKey('short'),/INVALID_IDEMPOTENCY_KEY/);
  assert.throws(()=>normalizeIdempotencyKey('bad key with spaces'),/INVALID_IDEMPOTENCY_KEY/);
});

test('same instant request key replays one authoritative round without a second settlement',()=>{
  const state={rounds:[]};
  const fingerprint=instantRequestFingerprint({game:'Roulette',stake:1_000_000,floor:'strip',betType:'RED'});
  let createCalls=0,settlementCalls=0;
  const execute=()=>{
    const attempt=idempotentInstantRound(state,{
      userId:'hanseo',game:'Roulette',key:'req-roulette-0001',fingerprint,
      create:()=>{createCalls++;return {id:'rou_authoritative',game:'Roulette',stake:1_000_000,betType:'RED',number:7,color:'RED',netPnl:1_000_000,userId:'hanseo',floor:'strip',status:'SETTLED',createdAt:'2026-09-15T00:00:00.000Z'};}
    });
    if(!attempt.replayed)settlementCalls++;
    return attempt;
  };
  const first=execute(),second=execute();
  assert.equal(first.replayed,false);
  assert.equal(second.replayed,true);
  assert.equal(second.round.id,first.round.id);
  assert.equal(state.rounds.length,1);
  assert.equal(createCalls,1);
  assert.equal(settlementCalls,1);
});

test('same key with a different wager fingerprint is rejected instead of re-settled',()=>{
  const state={rounds:[]};
  const original=instantRequestFingerprint({game:'Baccarat',stake:1_000_000,floor:'strip',betType:'PLAYER'});
  idempotentInstantRound(state,{userId:'hanseo',game:'Baccarat',key:'req-baccarat-001',fingerprint:original,create:()=>({id:'bac_1',game:'Baccarat',userId:'hanseo',status:'SETTLED'})});
  const changed=instantRequestFingerprint({game:'Baccarat',stake:3_000_000,floor:'strip',betType:'BANKER'});
  assert.throws(()=>idempotentInstantRound(state,{userId:'hanseo',game:'Baccarat',key:'req-baccarat-001',fingerprint:changed,create:()=>({id:'bac_2',game:'Baccarat',userId:'hanseo',status:'SETTLED'})}),/IDEMPOTENCY_CONFLICT/);
  assert.equal(state.rounds.length,1);
});

test('legacy clients without a key keep normal one-request-one-round behavior',()=>{
  const state={rounds:[]};
  const fingerprint=instantRequestFingerprint({game:'Sic Bo',stake:1_000_000,floor:'strip',betType:'BIG'});
  for(let i=0;i<2;i++)idempotentInstantRound(state,{userId:'hanseo',game:'Sic Bo',key:null,fingerprint,create:()=>({id:`sic_${i}`,game:'Sic Bo',userId:'hanseo',status:'SETTLED'})});
  assert.equal(state.rounds.length,2);
});

test('public instant round omits server-only retry and ownership metadata',()=>{
  const view=instantPublicRound({id:'rou_1',game:'Roulette',stake:1_000_000,number:7,color:'RED',netPnl:1_000_000,userId:'hanseo',floor:'strip',status:'SETTLED',createdAt:'now',idempotency:{key:'req-roulette-0001',fingerprint:'fp'}});
  assert.deepEqual(view,{id:'rou_1',game:'Roulette',stake:1_000_000,number:7,color:'RED',netPnl:1_000_000});
});
