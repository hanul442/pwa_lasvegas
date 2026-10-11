import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { upgradeEconomy, economyCurrent } from '../lib/economy-upgrade.mjs';

test('the 1천만 economy tops every player up to the 10억 start once, through the ledger', () => {
  const state = defaultState();
  assert.ok(economyCurrent(state), 'a fresh world starts on the new economy');
  state.meta.economy = 1; // a world saved before the change
  state.users.hanseo.account.available = 95_000_000;
  state.users.zero.account.available = 20_000_000_000;
  const rich = state.users.zero.account.available;
  assert.equal(upgradeEconomy(state), true);
  assert.equal(state.users.hanseo.account.available, 1_000_000_000);
  const row = state.ledger.at(-1);
  assert.equal(row.referenceType, 'ECONOMY_UPGRADE');
  assert.equal(state.ledger.filter(x => x.referenceType === 'ECONOMY_UPGRADE' && x.userId === 'hanseo')[0].amount, 905_000_000);
  assert.equal(state.users.hanseo.account.qualifiedPnl, 0, 'a top-up is not winnings');
  assert.equal(state.users.zero.account.available, rich, 'nobody above the start is touched');
  assert.equal(upgradeEconomy(state), false, 'runs once');
  assert.equal(state.users.hanseo.account.available, 1_000_000_000);
});
