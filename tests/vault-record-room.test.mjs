import test from 'node:test';
import assert from 'node:assert/strict';
import { vaultRecordRoomModel } from '../public/vault-record-room.js';

test('vault record room uses VIP records and preserves locked progression',()=>{
  const model=vaultRecordRoomModel({
    floors:[{slug:'vault',unlocked:false,threshold:100_000_000_000,remaining:12_000_000_000,progress:.88,minBet:1_000_000_000,maxBet:10_000_000_000}],
    rankings:{records:{
      wealth:{nickname:'Global',value:500},profit:{nickname:'GlobalP',value:400},highRoller:{nickname:'GlobalH',value:300},peakBankroll:{nickname:'GlobalK',value:600},
      vip:{wealth:{nickname:'VIP W',value:250},profit:{nickname:'VIP P',value:200},highRoller:{nickname:'VIP H',value:180},peakBankroll:{nickname:'VIP K',value:300}}
    }}
  });
  assert.equal(model.enabled,true);
  assert.equal(model.unlocked,false);
  assert.equal(model.remaining,12_000_000_000);
  assert.equal(model.records[0][1].nickname,'VIP W');
  assert.equal(model.records.length,4);
  assert.equal(model.tables.length,4);
});

test('vault model falls back to global records when no VIP cohort exists',()=>{
  const model=vaultRecordRoomModel({
    floors:[{slug:'vault',unlocked:true,threshold:100,remaining:0,progress:1,minBet:10,maxBet:100}],
    rankings:{records:{wealth:{nickname:'A',value:10},profit:{nickname:'B',value:9},highRoller:{nickname:'C',value:8},peakBankroll:{nickname:'D',value:11},vip:null}}
  });
  assert.equal(model.unlocked,true);
  assert.deepEqual(model.records.map(([,r])=>r.nickname),['A','B','C','D']);
});

test('vault model fails closed without canonical floor/ranking data',()=>{
  assert.deepEqual(vaultRecordRoomModel({}),{enabled:false});
});
