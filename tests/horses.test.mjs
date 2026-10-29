import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { handleApi } from '../lib/api.mjs';
import {
  HORSE_GAME, RUNNERS, SEGMENTS, HOUSE_MARGIN, STABLE, createCard, publicCard, racingBook, runRace, drawOrder,
  winProbabilities, placeProbabilities, quoteOdds, horsePayout, betWins, playHorseRace,
  exactaProbability, pairOdds, PAIR_ODDS_CAP
} from '../lib/horses.mjs';

// A seeded generator so the long simulations are repeatable.
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('odds are the fair price less the margin, rounded down to the board step', () => {
  assert.equal(quoteOdds(0.5), 190);
  assert.equal(quoteOdds(0.25), 380);
  assert.equal(quoteOdds(0.1), 950);
  assert.equal(quoteOdds(0.33), 285, 'under 3배 the board moves in 0.05s');
  assert.equal(quoteOdds(0.99), 105, 'never under 1.05배');
  for (let p = 0.03; p < 0.8; p += 0.001) {
    const back = p * quoteOdds(p) / 100;
    assert.ok(back <= 1 - HOUSE_MARGIN + 1e-9, `p=${p} returns ${back}`);
    assert.ok(back >= 0.9, `p=${p} returns ${back}`);
  }
});

test('Harville place chances add up to two places', () => {
  const s = [3, 2, 1.5, 1, 0.7, 0.4];
  const p = winProbabilities(s), pp = placeProbabilities(s);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(pp.reduce((a, b) => a + b, 0) - 2) < 1e-12);
  pp.forEach((x, i) => assert.ok(x > p[i] && x < 1));
});

test('every card gives the house a 5–10% edge on every single bet', () => {
  const rng = mulberry(7);
  for (let i = 0; i < 2000; i++) {
    const card = createCard(null, 1, rng);
    assert.equal(card.runners.length, RUNNERS);
    assert.equal(new Set(card.runners.map(r => r.id)).size, RUNNERS);
    const s = card.runners.map(r => r.strength);
    const p = winProbabilities(s), pp = placeProbabilities(s);
    card.runners.forEach((r, k) => {
      for (const ret of [p[k] * r.win / 100, pp[k] * r.place / 100]) assert.ok(ret >= 0.9 && ret <= 0.95 + 1e-9, String(ret));
      assert.ok(r.place <= r.win);
    });
  }
});

test('simulated over many races, win and place bets both return 90–95%', () => {
  const rng = mulberry(42);
  const N = 40_000;
  let win = 0, place = 0, favWins = 0, photos = 0;
  for (let i = 0; i < N; i++) {
    const card = createCard(null, 1, rng);
    const race = runRace(card, rng);
    for (const r of card.runners) {
      if (betWins('WIN', r.gate, race.order)) win += r.win / 100;
      if (betWins('PLACE', r.gate, race.order)) place += r.place / 100;
    }
    const fav = card.runners.reduce((a, b) => (b.win < a.win ? b : a));
    if (race.order[0] === fav.gate) favWins++;
    if (race.photo) photos++;
  }
  const winRtp = win / (N * RUNNERS), placeRtp = place / (N * RUNNERS);
  assert.ok(winRtp > 0.9 && winRtp < 0.95, `win RTP ${winRtp}`);
  assert.ok(placeRtp > 0.9 && placeRtp < 0.95, `place RTP ${placeRtp}`);
  assert.ok(favWins / N > 0.25 && favWins / N < 0.5, `favourite wins ${favWins / N}`);
  assert.ok(photos / N > 0.25 && photos / N < 0.42, `photo finishes ${photos / N}`);
});

test('the finishing order follows the strengths', () => {
  const rng = mulberry(3);
  const s = [4, 2, 1, 1, 0.5, 0.5];
  const firsts = Array(6).fill(0);
  for (let i = 0; i < 30_000; i++) firsts[drawOrder(s, rng)[0]]++;
  winProbabilities(s).forEach((p, i) => assert.ok(Math.abs(firsts[i] / 30_000 - p) < 0.012, `${i}: ${firsts[i] / 30_000} vs ${p}`));
});

test('pace keyframes end on each horse’s finishing time in the drawn order', () => {
  const rng = mulberry(11);
  for (let i = 0; i < 500; i++) {
    const card = createCard(null, 1, rng);
    const race = runRace(card, rng);
    assert.deepEqual([...race.order].sort(), [1, 2, 3, 4, 5, 6]);
    race.splits.forEach((sp, k) => {
      assert.equal(sp.length, SEGMENTS + 1);
      assert.equal(sp[0], 0);
      assert.equal(sp[SEGMENTS], race.times[k]);
      for (let j = 1; j < sp.length; j++) assert.ok(sp[j] > sp[j - 1]);
    });
    const finish = gate => race.times[gate - 1];
    for (let k = 1; k < RUNNERS; k++) assert.ok(finish(race.order[k]) > finish(race.order[k - 1]));
    assert.equal(race.margin, finish(race.order[1]) - finish(race.order[0]));
    assert.equal(race.photo, race.margin < 100);
  }
});

test('payouts: winnings in whole 100만s, a remainder rounds at random (fair on average)', () => {
  assert.equal(horsePayout(10_000_000, 420), 32_000_000);
  assert.equal(horsePayout(1_000_000, 420, () => 0.3), 3_000_000, '320만 is 300만 80% of the time');
  assert.equal(horsePayout(1_000_000, 420, () => 0.1), 4_000_000, '... and 400만 20% of the time');
  assert.equal(horsePayout(1_000_000, 135, () => 0.5), 0);
  assert.equal(horsePayout(1_000_000, 135, () => 0.2), 1_000_000);
  assert.equal(horsePayout(100, 135), 35, 'bare engine stakes keep whole won');
  assert.ok(betWins('PLACE', 4, [2, 4, 1, 3, 5, 6]));
  assert.ok(!betWins('WIN', 4, [2, 4, 1, 3, 5, 6]));
  assert.throws(() => betWins('SHOW', 4, [2, 4, 1, 3, 5, 6]), /INVALID_BET_TYPE/);
});

test('a bet runs the card it was placed on, updates the form and draws the next card', () => {
  const rng = mulberry(5);
  const user = {};
  const book = racingBook(user, rng);
  const card = book.card;
  assert.equal(card.raceNo, 1);
  for (const h of STABLE) assert.equal(book.form[h.id].length, 5);
  const pub = publicCard(card);
  assert.ok(pub.runners.every(r => r.strength === undefined && r.name && r.tag && r.win && r.place));
  assert.throws(() => playHorseRace(user, { stake: 1_000_000, betType: 'WIN', pick: 1, cardId: 'race_old' }, rng), /RACE_CARD_STALE/);
  assert.throws(() => playHorseRace(user, { stake: 1_000_000, betType: 'WIN', pick: 7, cardId: card.id }, rng), /INVALID_TARGET/);
  assert.throws(() => playHorseRace(user, { stake: 1_000_000, betType: 'TRIFECTA', pick: 1, cardId: card.id }, rng), /INVALID_BET_TYPE/);
  const pick = card.runners[2];
  const round = playHorseRace(user, { stake: 10_000_000, betType: 'WIN', pick: pick.gate, cardId: card.id }, rng);
  assert.equal(round.game, HORSE_GAME);
  assert.equal(round.odds, pick.win);
  assert.equal(round.won, round.order[0] === pick.gate);
  assert.equal(round.netPnl, round.won ? horsePayout(10_000_000, pick.win) : -10_000_000);
  const winner = card.runners.find(r => r.gate === round.order[0]);
  assert.equal(user.racing.form[winner.id][0], 1);
  assert.notEqual(user.racing.card.id, card.id);
  assert.equal(user.racing.card.raceNo, 2);
});

function api(initial) {
  let state = initial;
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, key) => handleApi({ method, header: n => (n === 'x-idempotency-key' ? key : undefined), body: async () => body }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  return { call, get state() { return state; } };
}

test('a race settles through the API as one idempotent instant round', async () => {
  const s = defaultState();
  s.users.hanseo.account.available = 300_000_000;
  const h = api(s), { call } = h;
  const card = await call('GET', '/api/horses/card');
  assert.equal(card.status, 200);
  assert.equal(card.data.card.runners.length, 6);
  assert.equal(card.data.card.runners[0].strength, undefined, 'strengths stay on the server');
  const again = await call('GET', '/api/horses/card');
  assert.equal(again.data.card.id, card.data.card.id, 'the card holds until it is raced');

  const before = 300_000_000;
  const body = { stake: 10_000_000, floor: 'high-limit', betType: 'PLACE', pick: 2, cardId: card.data.card.id };
  const res = await call('POST', '/api/horses/race', body, 'race-key-0001');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const round = res.data.round;
  assert.equal(round.game, HORSE_GAME);
  assert.equal(round.splits.length, 6);
  assert.equal(round.card.id, card.data.card.id);
  assert.equal(round.userId, undefined);
  assert.equal(res.data.state.user.account.available, before + round.netPnl);
  assert.notEqual(res.data.next.id, card.data.card.id, 'the next race has its own card');
  assert.equal(res.data.state.user.stats[HORSE_GAME].rounds, 1);
  assert.equal(res.data.state.ledger[0].referenceId, round.id);

  // The same key replays the same race and pays once.
  const replay = await call('POST', '/api/horses/race', body, 'race-key-0001');
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.round.id, round.id);
  assert.deepEqual(replay.data.round.order, round.order);
  assert.equal(replay.data.state.user.account.available, res.data.state.user.account.available);

  // The same key with another wager is refused; a fresh key on the old card is stale.
  assert.equal((await call('POST', '/api/horses/race', { ...body, pick: 3 }, 'race-key-0001')).data.error, 'IDEMPOTENCY_CONFLICT');
  const stale = await call('POST', '/api/horses/race', body, 'race-key-0002');
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, 'RACE_CARD_STALE');
  assert.equal(h.state.users.hanseo.account.available, res.data.state.user.account.available);
});

test('복승 and 쌍승 are quoted from the same Harville chances with the same margin', () => {
  const rng = mulberry(11);
  for (let i = 0; i < 500; i++) {
    const card = createCard(null, 1, rng);
    const st = card.runners.map(r => r.strength);
    const { quinella, exacta } = pairOdds(card);
    assert.equal(Object.keys(quinella).length, 15);
    assert.equal(Object.keys(exacta).length, 30);
    let sumX = 0;
    card.runners.forEach((a, x) => card.runners.forEach((b, y) => {
      if (x === y) return;
      const p = exactaProbability(st, x, y); sumX += p;
      const back = p * exacta[`${a.gate}-${b.gate}`] / 100;
      if (exacta[`${a.gate}-${b.gate}`] < PAIR_ODDS_CAP) assert.ok(back <= 1 - HOUSE_MARGIN + 1e-9 && back >= 0.9, `exacta returns ${back}`);
      if (a.gate < b.gate) {
        const q = p + exactaProbability(st, y, x);
        const qb = q * quinella[`${a.gate}-${b.gate}`] / 100;
        assert.ok(qb <= 1 - HOUSE_MARGIN + 1e-9 && qb >= 0.9, `quinella returns ${qb}`);
        assert.ok(quinella[`${a.gate}-${b.gate}`] <= Math.min(exacta[`${a.gate}-${b.gate}`], exacta[`${b.gate}-${a.gate}`]), 'either way round is never dearer');
      }
    }));
    assert.ok(Math.abs(sumX - 1) < 1e-9, 'every first-second order adds up to one');
  }
  assert.equal(betWins('EXACTA', [3, 5], [3, 5, 1]), true);
  assert.equal(betWins('EXACTA', [5, 3], [3, 5, 1]), false);
  assert.equal(betWins('QUINELLA', [3, 5], [5, 3, 1]), true);
  assert.equal(betWins('QUINELLA', [3, 1], [5, 3, 1]), false);
});

test('a 쌍승 simulation returns what the board promised', () => {
  const rng = mulberry(5);
  const user = { id: 'u', racing: null };
  let staked = 0, back = 0, wins = 0;
  for (let i = 0; i < 6000; i++) {
    const card = racingBook(user, rng).card;
    const pick = [card.runners[i % 6].gate, card.runners[(i + 1 + (i % 5)) % 6].gate];
    const betType = i % 2 ? 'EXACTA' : 'QUINELLA';
    const r = playHorseRace(user, { stake: 1_000_000, betType, pick, cardId: card.id }, rng);
    staked += 1_000_000; back += r.netPnl + 1_000_000; if (r.won) wins++;
    assert.equal(r.won, betWins(betType, betType === 'QUINELLA' ? [...pick].sort((a, b) => a - b) : pick, r.order));
  }
  const rtp = back / staked;
  assert.ok(wins > 200, `wins ${wins}`);
  assert.ok(rtp > 0.8 && rtp < 1.05, `returns ${rtp}`);
});

test('race bets keep the floor’s limits', async () => {
  const s = defaultState();
  s.users.hanseo.account.available = 300_000_000;
  const { call } = api(s);
  const card = (await call('GET', '/api/horses/card')).data.card;
  const bet = over => call('POST', '/api/horses/race', { stake: 10_000_000, floor: 'high-limit', betType: 'WIN', pick: 1, cardId: card.id, ...over });
  assert.equal((await bet({ stake: 5_000_000 })).data.error, 'BET_OUTSIDE_TABLE_LIMIT');
  assert.equal((await bet({ stake: 200_000_000 })).data.error, 'BET_OUTSIDE_TABLE_LIMIT');
  assert.equal((await bet({ stake: 10_500_000 })).data.error, 'BET_NOT_IN_UNITS');
  assert.equal((await bet({ pick: 9 })).data.error, 'INVALID_TARGET');
  assert.equal((await bet({ betType: 'TRIFECTA' })).data.error, 'INVALID_BET_TYPE');
  assert.equal((await bet({ betType: 'EXACTA', pick: [2, 2] })).data.error, 'INVALID_TARGET');
  assert.equal((await bet({ betType: 'QUINELLA', pick: 2 })).data.error, 'INVALID_TARGET');
  assert.ok(card.quinella['1-2'] >= 105 && card.exacta['2-1'] >= 105, 'the card carries both pair boards');
  const pair = await bet({ betType: 'QUINELLA', pick: [4, 1] });
  assert.equal(pair.status, 200, JSON.stringify(pair.data));
  assert.deepEqual(pair.data.round.pick, [1, 4]);
  assert.equal(pair.data.round.odds, card.quinella['1-4']);
  assert.equal(pair.data.round.won, [pair.data.round.order[0], pair.data.round.order[1]].sort().join() === '1,4');
  const next = pair.data.next;
  const ok = await call('POST', '/api/horses/race', { stake: 10_000_000, floor: 'high-limit', betType: 'EXACTA', pick: [3, 6], cardId: next.id });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.round.odds, next.exacta['3-6']);
  assert.equal(ok.data.state.user.stats[HORSE_GAME].rounds, 2);
});

test('the 경마 table is wired into the lobby, the guide, the music and the offline shell', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');
  const [app, sw, html, client, guides, music] = await Promise.all(['app.js', 'sw.js', 'index.html', 'js/games/horses.js', 'js/guides.js', 'js/music.js'].map(read));
  assert.match(app, /\{ id: 'horses', name: '경마'/);
  assert.match(app, /'slots', 'horses'\]/);
  assert.match(sw, /'js\/games\/horses\.js'/);
  assert.match(sw, /'horses\.css'/);
  assert.match(html, /href="horses\.css"/);
  assert.match(client, /api\.horsesRace\(/);
  assert.match(client, /t\.settle\(/);
  assert.match(guides, /\n  horses: \{/);
  assert.match(music, /\n  horses: \{/);
});
