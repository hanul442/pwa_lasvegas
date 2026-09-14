import test from 'node:test';
import assert from 'node:assert/strict';
import { vaultEntryIntent } from '../public/vault-record-room.js';

test('Vault signature tables map to canonical live game ids',()=>{
  assert.deepEqual(vaultEntryIntent('blackjack',true),{floor:'vault',gameId:'blackjack',tableId:'obsidian-blackjack'});
  assert.deepEqual(vaultEntryIntent('baccarat',true),{floor:'vault',gameId:'baccarat',tableId:'rouge-baccarat'});
  assert.deepEqual(vaultEntryIntent('roulette',true),{floor:'vault',gameId:'roulette',tableId:'zero-chamber'});
  assert.deepEqual(vaultEntryIntent('sicbo',true),{floor:'vault',gameId:'sicbo',tableId:'dragon-dice'});
});

test('Vault entry fails closed while locked or for unknown games',()=>{
  assert.equal(vaultEntryIntent('blackjack',false),null);
  assert.equal(vaultEntryIntent('holdem',true),null);
  assert.equal(vaultEntryIntent('',true),null);
});
