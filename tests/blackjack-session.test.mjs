import test from 'node:test';
import assert from 'node:assert/strict';
import { blackjackSessionKey, saveBlackjackSession, loadBlackjackSession, clearBlackjackSession } from '../public/blackjack-session.js';

function memoryStorage(){
  const map=new Map();
  return {
    getItem:key=>map.has(key)?map.get(key):null,
    setItem:(key,value)=>map.set(key,String(value)),
    removeItem:key=>map.delete(key)
  };
}

function activeRound(){
  return {
    id:'bj2_test',engineVersion:'MULTI_SPOT_V2',status:'PLAYER',activeHand:0,spots:2,baseStake:1_000_000,
    hands:[{id:'h1',spot:1,cards:['10♠','8♦'],value:18,status:'PLAYING',active:true}]
  };
}

test('blackjack session is isolated per player and restores active public round',()=>{
  const storage=memoryStorage();
  const round=activeRound();
  assert.equal(saveBlackjackSession(storage,'hanseo',round),true);
  assert.equal(blackjackSessionKey('hanseo'),'sv-bjv2-session:hanseo');
  assert.deepEqual(loadBlackjackSession(storage,'hanseo'),round);
  assert.equal(loadBlackjackSession(storage,'min'),null);
});

test('settled or malformed rounds fail closed and are not persisted',()=>{
  const storage=memoryStorage();
  const settled={...activeRound(),status:'SETTLED'};
  assert.equal(saveBlackjackSession(storage,'hanseo',settled),false);
  assert.equal(loadBlackjackSession(storage,'hanseo'),null);
  storage.setItem(blackjackSessionKey('hanseo'),'{bad json');
  assert.equal(loadBlackjackSession(storage,'hanseo'),null);
});

test('stale sessions expire and explicit clear removes recovery state',()=>{
  const storage=memoryStorage();
  const round=activeRound();
  storage.setItem(blackjackSessionKey('hanseo'),JSON.stringify({round,updatedAt:Date.now()-10_000}));
  assert.equal(loadBlackjackSession(storage,'hanseo',1_000),null);
  saveBlackjackSession(storage,'hanseo',round);
  clearBlackjackSession(storage,'hanseo');
  assert.equal(loadBlackjackSession(storage,'hanseo'),null);
});
