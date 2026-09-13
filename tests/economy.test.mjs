import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { autoRecharge, lockBet, settleHouseGame, settleLockedHouseGame, requestRecharge, reviewRecharge } from '../lib/economy.mjs';

function fresh(){return defaultState()}

test('new user starts at 1억 and Strip is unlocked',()=>{
  const s=fresh(),u=s.users.hanseo;
  assert.equal(u.account.available,100_000_000);
  assert.deepEqual(u.account.unlockedFloors,['downtown','strip']);
});

test('locked bet conserves total balance until settlement',()=>{
  const s=fresh(),u=s.users.hanseo;
  lockBet(s,u,{stake:10_000_000,game:'Blackjack',roundId:'r1'});
  assert.equal(u.account.available,90_000_000);
  assert.equal(u.account.locked,10_000_000);
  settleLockedHouseGame(s,u,{game:'Blackjack',stake:10_000_000,netPnl:10_000_000,roundId:'r1'});
  assert.equal(u.account.available,110_000_000);
  assert.equal(u.account.locked,0);
  assert.equal(u.account.qualifiedPnl,10_000_000);
});

test('loss cannot create negative bankroll',()=>{
  const s=fresh(),u=s.users.hanseo;
  assert.throws(()=>settleHouseGame(s,u,{game:'Roulette',stake:200_000_000,netPnl:-200_000_000,roundId:'r2'}),/INSUFFICIENT_BANKROLL/);
});

test('admin grant changes bankroll but never qualified P/L',()=>{
  const s=fresh(),admin=s.users.hanseo,u=s.users.min;
  u.account.available=0;
  const req=requestRecharge(s,u,50_000_000,'test');
  reviewRecharge(s,admin,req.id,'APPROVE',50_000_000);
  assert.equal(u.account.available,50_000_000);
  assert.equal(u.account.qualifiedPnl,0);
});

test('auto recharge only tops up to 5천만',()=>{
  const s=fresh(),u=s.users.hanseo;
  u.account.available=12_000_000;
  autoRecharge(s,u);
  assert.equal(u.account.available,50_000_000);
  assert.equal(u.recharge.total,38_000_000);
});

test('qualified profit unlocks High Limit at 10억 progression',()=>{
  const s=fresh(),u=s.users.hanseo;
  u.account.available=2_000_000_000;
  settleHouseGame(s,u,{game:'Baccarat',stake:900_000_000,netPnl:900_000_000,roundId:'bigwin'});
  assert.equal(u.account.progressionValue,1_000_000_000);
  assert.ok(u.account.unlockedFloors.includes('high-limit'));
});
