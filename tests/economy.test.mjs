import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { addLedger, autoRecharge, lockBet, settleHouseGame, settleLockedHouseGame, requestRecharge, reviewRecharge } from '../lib/economy.mjs';

function fresh(){return defaultState()}

test('new user starts at 10억 and Strip is unlocked',()=>{
  const s=fresh(),u=s.users.hanseo;
  assert.equal(u.account.available,1_000_000_000);
  assert.deepEqual(u.account.unlockedFloors,['downtown','strip']);
});

test('locked bet conserves total balance until settlement',()=>{
  const s=fresh(),u=s.users.hanseo;
  lockBet(s,u,{stake:100_000_000,game:'Blackjack',roundId:'r1'});
  assert.equal(u.account.available,900_000_000);
  assert.equal(u.account.locked,100_000_000);
  settleLockedHouseGame(s,u,{game:'Blackjack',stake:100_000_000,netPnl:100_000_000,roundId:'r1'});
  assert.equal(u.account.available,1_100_000_000);
  assert.equal(u.account.locked,0);
  assert.equal(u.account.qualifiedPnl,100_000_000);
});

test('locked round cannot settle twice even if other locked CH exists',()=>{
  const s=fresh(),u=s.users.hanseo;
  lockBet(s,u,{stake:100_000_000,game:'Blackjack',roundId:'locked-a'});
  lockBet(s,u,{stake:100_000_000,game:'Blackjack',roundId:'locked-b'});
  settleLockedHouseGame(s,u,{game:'Blackjack',stake:100_000_000,netPnl:100_000_000,roundId:'locked-a'});
  const before={available:u.account.available,locked:u.account.locked,pnl:u.account.qualifiedPnl,wagered:u.account.totalWagered,ledger:s.ledger.length};
  assert.throws(()=>settleLockedHouseGame(s,u,{game:'Blackjack',stake:100_000_000,netPnl:100_000_000,roundId:'locked-a'}),/ROUND_ALREADY_SETTLED/);
  assert.deepEqual({available:u.account.available,locked:u.account.locked,pnl:u.account.qualifiedPnl,wagered:u.account.totalWagered,ledger:s.ledger.length},before);
});

test('instant round cannot write a second settlement ledger entry',()=>{
  const s=fresh(),u=s.users.hanseo;
  settleHouseGame(s,u,{game:'Roulette',stake:10_000_000,netPnl:10_000_000,roundId:'instant-a'});
  const before={available:u.account.available,pnl:u.account.qualifiedPnl,wagered:u.account.totalWagered,rounds:u.stats.Roulette.rounds,ledger:s.ledger.length};
  assert.throws(()=>settleHouseGame(s,u,{game:'Roulette',stake:10_000_000,netPnl:10_000_000,roundId:'instant-a'}),/ROUND_ALREADY_SETTLED/);
  assert.deepEqual({available:u.account.available,pnl:u.account.qualifiedPnl,wagered:u.account.totalWagered,rounds:u.stats.Roulette.rounds,ledger:s.ledger.length},before);
});

test('loss cannot create negative bankroll',()=>{
  const s=fresh(),u=s.users.hanseo;
  assert.throws(()=>settleHouseGame(s,u,{game:'Roulette',stake:2_000_000_000,netPnl:-2_000_000_000,roundId:'r2'}),/INSUFFICIENT_BANKROLL/);
});

test('admin grant changes bankroll but never qualified P/L',()=>{
  const s=fresh(),admin=s.users.hanseo,u=s.users.min;
  u.account.available=0;
  const req=requestRecharge(s,u,500_000_000,'test');
  reviewRecharge(s,admin,req.id,'APPROVE',500_000_000);
  assert.equal(u.account.available,500_000_000);
  assert.equal(u.account.qualifiedPnl,0);
});

test('auto recharge only tops up to 5억',()=>{
  const s=fresh(),u=s.users.hanseo;
  u.account.available=120_000_000;
  autoRecharge(s,u);
  assert.equal(u.account.available,500_000_000);
  assert.equal(u.recharge.total,380_000_000);
});

test('holding 100억 opens High Limit, and it stays open after losing it',()=>{
  const s=fresh(),u=s.users.hanseo;
  u.account.available=1_000_000_000;
  settleHouseGame(s,u,{game:'Baccarat',stake:1_000_000_000,netPnl:9_000_000_000,roundId:'bigwin'});
  assert.equal(u.account.progressionValue,u.account.available+u.account.locked);
  assert.ok(u.account.progressionValue>=10_000_000_000);
  assert.ok(u.account.unlockedFloors.includes('high-limit'));
  settleHouseGame(s,u,{game:'Baccarat',stake:6_000_000_000,netPnl:-6_000_000_000,roundId:'bigloss'});
  assert.ok(u.account.progressionValue<10_000_000_000);
  assert.ok(u.account.unlockedFloors.includes('high-limit'));
});

test('chips from any source count toward the next floor',()=>{
  const s=fresh(),u=s.users.hanseo;
  addLedger(s,u,{type:'ADMIN_GRANT',amount:9_000_000_000,referenceType:'TEST'});
  assert.equal(u.account.progressionValue,u.account.available+u.account.locked);
  assert.ok(u.account.unlockedFloors.includes('high-limit'));
});
