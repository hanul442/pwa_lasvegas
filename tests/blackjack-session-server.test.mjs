import test from 'node:test';
import assert from 'node:assert/strict';
import { activeBlackjackV2Round } from '../lib/blackjack-session.mjs';

test('authoritative recovery returns only the users active blackjack v2 round',()=>{
  const state={rounds:[
    {id:'legacy',userId:'hanseo',game:'Blackjack',status:'PLAYER'},
    {id:'other',userId:'min',game:'Blackjack',engineVersion:'MULTI_SPOT_V2',status:'PLAYER'},
    {id:'settled',userId:'hanseo',game:'Blackjack',engineVersion:'MULTI_SPOT_V2',status:'SETTLED'},
    {id:'active',userId:'hanseo',game:'Blackjack',engineVersion:'MULTI_SPOT_V2',status:'PLAYER'}
  ]};
  assert.equal(activeBlackjackV2Round(state,'hanseo')?.id,'active');
  assert.equal(activeBlackjackV2Round(state,'ghost'),null);
});

test('authoritative recovery fails closed for malformed state',()=>{
  assert.equal(activeBlackjackV2Round(null,'hanseo'),null);
  assert.equal(activeBlackjackV2Round({},'hanseo'),null);
  assert.equal(activeBlackjackV2Round({rounds:[]},''),null);
});
