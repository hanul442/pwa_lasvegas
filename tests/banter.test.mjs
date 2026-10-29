// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEOTDA_AI } from '../lib/seotda.mjs';
import { GOSTOP_AI_NAMES } from '../lib/gostop.mjs';
import { MATGO_AI_NAMES, matgoAiSeat, startMatgo, matgoAiDecision } from '../lib/matgo.mjs';

const src = readFileSync(new URL('../public/js/banter.js', import.meta.url), 'utf8');
const personas = [...src.matchAll(/^  '([^']+)': \{$/gm)].map(m => m[1]);
const cardRoom = readFileSync(new URL('../lib/card-room.mjs', import.meta.url), 'utf8');
const tazza = JSON.parse(cardRoom.match(/TAZZA_NAMES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));

test('every AI who sits at a 화투 table has a voice of their own', () => {
  for (const name of [...SEOTDA_AI.map(a => a.name), ...GOSTOP_AI_NAMES, ...MATGO_AI_NAMES, ...tazza]) {
    assert.ok(personas.includes(name), `${name} has no lines`);
  }
});

test('맞고 seats one of the named regulars instead of a faceless house AI', () => {
  for (let i = 0; i < MATGO_AI_NAMES.length; i++) {
    const seat = matgoAiSeat(() => i);
    assert.equal(seat.kind, 'ai');
    assert.equal(seat.name, MATGO_AI_NAMES[i]);
  }
});

test('a bold regular calls 고 more often than a careful one', () => {
  const goRate = name => {
    let go = 0;
    for (let k = 0; k < 100; k++) {
      const round = startMatgo({ stake: 1_000_000, seats: [{ kind: 'human' }, { kind: 'ai', name }], rng: n => k % n });
      round.phase = 'GO_STOP'; round.pending = { seat: 1, score: 7 };
      round.hands[1] = round.hands[1].slice(0, 5);
      round.captured[0] = [];
      if (matgoAiDecision(round, 1, () => k).type === 'GO') go++;
    }
    return go;
  };
  assert.ok(goRate('박사장') > goRate('김여사'));
});
