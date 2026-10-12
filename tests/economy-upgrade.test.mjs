import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { upgradeEconomy, economyCurrent } from '../lib/economy-upgrade.mjs';

test('the bank economy keeps every balance and reopens floors on the new ladder, once', () => {
  const state = defaultState();
  assert.ok(economyCurrent(state), 'a fresh world starts on the new economy');
  state.meta.economy = 2; // a world saved on the 1천만 scale
  state.users.hanseo.account.available = 95_000_000;
  state.users.hanseo.account.unlockedFloors = ['downtown', 'strip'];
  delete state.users.hanseo.credit;
  const ledger = state.ledger.length;
  assert.equal(upgradeEconomy(state), true);
  assert.equal(state.users.hanseo.account.available, 95_000_000, 'balances stay as they were');
  assert.equal(state.ledger.length, ledger, 'no chips move');
  // 9천5백만 opens every floor whose threshold (ten smallest bets) it covers: up to Gold Room.
  assert.deepEqual(state.users.hanseo.account.unlockedFloors, ['corner', 'main-street', 'house', 'downtown', 'strip', 'gold-room']);
  assert.equal(state.users.hanseo.credit.score, 500);
  assert.equal(upgradeEconomy(state), false, 'runs once');
});
