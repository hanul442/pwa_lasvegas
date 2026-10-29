// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { advance, fresh, nudgeDue, overLimit, withLimit, rested, MIN, HOUR, BREAK, WARNING, duration } = await import('../public/js/playtime.js');
const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');
const t0 = new Date(2026, 9, 13, 20, 0).getTime();

// Ten-second ticks with the app on screen.
function play(s, from, ms) {
  for (let t = from + 10e3; t <= from + ms; t += 10e3) s = advance(s, t, true);
  return s;
}

test('an hour of continuous play asks for the notice once, then again at two hours', () => {
  let s = advance(fresh(t0), t0, false);
  s = play(s, t0, 59 * MIN);
  assert.equal(nudgeDue(s), 0);
  s = play(s, t0 + 59 * MIN, MIN);
  assert.equal(nudgeDue(s), 1);
  s = { ...s, nudged: 1 };
  s = play(s, t0 + HOUR, 30 * MIN);
  assert.equal(nudgeDue(s), 0);
  s = play(s, t0 + 90 * MIN, 30 * MIN);
  assert.equal(nudgeDue(s), 2);
});

test('a break of 15 minutes restarts the continuous clock but not the day total', () => {
  let s = play(advance(fresh(t0), t0, false), t0, 50 * MIN);
  s = advance(s, t0 + 50 * MIN + BREAK, false);
  assert.equal(s.run, 0);
  assert.ok(s.today >= 50 * MIN - 10e3);
  // A short look away does not.
  s = play(s, s.last, 20 * MIN);
  s = advance(s, s.last + 5 * MIN, false);
  assert.ok(s.run >= 19 * MIN);
});

test('a phone asleep with the app open never counts more than a minute per tick', () => {
  let s = advance(fresh(t0), t0, false);
  s = advance(s, t0 + 10 * MIN, true);
  assert.equal(s.run, MIN);
});

test('the daily limit: stricter now, looser tomorrow, and the day total resets at midnight', () => {
  let s = withLimit(fresh(t0), 120);
  assert.equal(s.limit, 120);
  s = withLimit(s, 60);
  assert.equal(s.limit, 60);
  s = withLimit(s, 0);
  assert.equal(s.limit, 60);
  assert.equal(s.nextLimit, 0);
  s = play(advance(s, t0, false), t0, HOUR);
  assert.equal(overLimit(s), true);
  const tomorrow = new Date(2026, 9, 14, 9, 0).getTime();
  s = advance(s, tomorrow, false);
  assert.equal(s.today, 0);
  assert.equal(s.limit, 0);
  assert.equal(overLimit(s), false);
});

test('finishing a rest clears the continuous clock', () => {
  const s = rested({ ...fresh(t0), run: 2 * HOUR, nudged: 2, today: 2 * HOUR });
  assert.equal(s.run, 0);
  assert.equal(s.nudged, 0);
  assert.equal(s.today, 2 * HOUR);
});

test('the notice carries the statutory sentence and the time played', async () => {
  assert.equal(WARNING, '과도한 게임이용은 정상적인 일상생활에 지장을 줄 수 있습니다.');
  assert.equal(duration(HOUR + 5 * MIN), '1시간 5분');
  assert.equal(duration(40 * MIN), '40분');
  const src = await read('js/playtime.js');
  assert.match(src, /const HOLD = 3000/);
  assert.match(await read('app.js'), /startPlaytime\(/);
});

test('sign-up asks for age and terms, and existing players agree once per version', async () => {
  const auth = await read('js/auth.js');
  assert.match(auth, /만 19세 이상이며 이용약관에 동의해요/);
  assert.match(auth, /markAgreed\(\)/);
  assert.match(await read('app.js'), /ensureTerms\(\)/);
  assert.match(await read('js/settings-panel.js'), /건강한 이용/);
});
