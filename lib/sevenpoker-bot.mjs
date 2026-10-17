// AI opponents for 7포커. A bot knows its own seven (or fewer) cards and everyone's open cards;
// it deals the unseen cards out a few dozen times to estimate its equity, then weighs that
// against the price and its temperament (the Hold'em styles, lib/holdem-bot.mjs). It only ever
// picks from the options the engine offers, so it can never make an illegal move.
import { evaluate, legalActions, potTotal, upCards, showing } from './sevenpoker.mjs';
import { RANK_VALUE } from './holdem.mjs';
import { BOT_STYLES } from './holdem-bot.mjs';
import { skillOf } from './constants.mjs';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const key = c => c.r + c.s;

// mine: my cards so far; opponents: each live opponent's open cards; dead: other cards seen
// (folded players' open cards). Everyone is dealt up to seven cards from what is left.
export function studEquity(mine, opponents, dead = [], iterations = 80, rand = Math.random) {
  if (!opponents.length) return 1;
  const used = new Set([...mine, ...opponents.flat(), ...dead].map(key));
  const rest = [];
  for (const s of SUITS) for (const r of RANKS) if (!used.has(r + s)) rest.push({ r, s });
  const needMine = Math.max(0, 7 - mine.length);
  const needs = opponents.map(o => Math.max(0, 7 - o.length));
  const take = needMine + needs.reduce((a, b) => a + b, 0);
  if (take > rest.length) return 1 / (opponents.length + 1);
  let score = 0;
  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < take; k++) { const j = k + Math.floor(rand() * (rest.length - k)); [rest[k], rest[j]] = [rest[j], rest[k]]; }
    let at = 0;
    const me = evaluate([...mine, ...rest.slice(at, at += needMine)]).score;
    let lost = false, ties = 0;
    for (let o = 0; o < opponents.length; o++) {
      const s = evaluate([...opponents[o], ...rest.slice(at, at += needs[o])]).score;
      if (s > me) { lost = true; break; }
      if (s === me) ties++;
    }
    if (!lost) score += ties ? 1 / (ties + 1) : 1;
  }
  return score / iterations;
}

// Which of the three first cards to turn up: keep a pair (or the high cards) hidden and show
// the odd one out. A low-floor bot sometimes just shows any card.
export function pickOpen(cards, skill = 1, rand = Math.random) {
  if (rand() > 0.4 + 0.6 * skill) return Math.floor(rand() * 3);
  const v = cards.map(c => RANK_VALUE[c.r]);
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (v[a] === v[b]) return 3 - a - b; // the card that is not in the pair
  // Same suit for two of them: show the third so the flush draw stays hidden.
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (cards[a].s === cards[b].s) return 3 - a - b;
  return v.indexOf(Math.min(...v));
}

export function decide(table, i, rand = Math.random) {
  const legal = legalActions(table, i);
  if (!legal) throw new Error('NOT_YOUR_TURN');
  const h = table.hand;
  if (legal.phase === 'CHOOSE') return { type: 'OPEN', index: pickOpen(h.players[i].cards, table.level == null ? 1 : skillOf(table.level), rand) };
  const seat = table.seats[i], me = h.players[i];
  const style = BOT_STYLES[seat.style] || BOT_STYLES.SHARK;
  const skill = table.level == null ? 1 : skillOf(table.level);
  const live = h.players.map((p, j) => (p && j !== i && !p.folded ? j : -1)).filter(j => j >= 0);
  const dead = h.players.flatMap((p, j) => (p && j !== i && p.folded ? upCards(p) : []));
  const eq = studEquity(me.cards, live.slice(0, 4).map(j => upCards(h.players[j])), dead, Math.round(25 + 55 * skill), rand);
  const pot = potTotal(table);
  const has = a => legal.options.find(o => o.action === a);
  const call = has('CALL');
  const priceOdds = call ? call.cost / (pot + call.cost) : 0;
  const fair = 1 / (live.length + 1);
  const sloppy = 1 - skill;
  const noise = (rand() - 0.5) * (0.06 + 0.3 * sloppy);
  const edge = eq - fair;
  const strong = edge + noise > 0.2 - style.tight;
  const monster = eq > 0.78;
  // A bot that can see it is already beaten on the open cards backs off a little.
  const myShow = showing(upCards(me));
  const outShown = live.some(j => showing(upCards(h.players[j])).score > myShow.score && h.street >= 5);
  const raise = (big = false) => {
    // Small: a 삥 or 쿼터 to open, a 따당 or 쿼터 on top of a bet. Big: 하프.
    const small = rand() < 0.5 ? ['BBING', 'DDADANG', 'QUARTER'] : ['QUARTER', 'DDADANG', 'BBING'];
    const pick = big ? ['HALF', 'DDADANG', 'QUARTER', 'BBING'] : [...small, 'HALF'];
    const o = pick.map(has).find(Boolean);
    return o ? { type: o.action } : null;
  };

  if (legal.canCheck) {
    if ((strong || monster) && rand() < style.aggro + (monster ? 0.2 : 0)) { const r = raise(monster || rand() < 0.5); if (r) return r; }
    if (rand() < style.bluff && live.length <= 2 && !outShown) { const r = raise(false); if (r) return r; }
    return { type: 'CHECK' };
  }
  const commitment = call.cost / (seat.stack + me.bet || 1);
  if (monster && rand() < style.aggro) { const r = raise(true); if (r) return r; }
  if (strong && rand() < style.aggro * 0.4) { const r = raise(false); if (r) return r; }
  const need = priceOdds + style.tight + (commitment > 0.5 ? 0.06 : 0) + (outShown ? 0.05 : 0) + noise - 0.1 * sloppy;
  if (eq >= need) return { type: 'CALL' };
  if (rand() < style.bluff * 0.25 && commitment < 0.15) { const r = raise(false); if (r) return r; }
  return { type: 'FOLD' };
}
