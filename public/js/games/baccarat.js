// Baccarat: back a side, then watch the cards get squeezed and the third-card rule play out.
import { api, errorMessage } from '../api.js';
import { dealCard, flipCard, sweepCards, parseCard } from '../cards.js';
import { wait, formatCH, animate } from '../fx.js';
import { Table } from '../table.js';
import { createDoubleOrNothing } from '../double-or-nothing.js';
import { eventInfo, createStreakMeter } from '../event-table.js';
import { seatCrowd } from '../npc.js';
import { voice } from '../voice.js';

const point = texts => texts.reduce((s, t) => { const c = parseCard(t); if (!c) return s; return s + (c.rank === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 0 : Number(c.rank)); }, 0) % 10;
const MAIN = ['PLAYER', 'BANKER', 'TIE'];
const PAIRS = ['PLAYER_PAIR', 'BANKER_PAIR'];
const rankOf = text => parseCard(text)?.rank;

// One bet's net under real rules: tie pushes Player/Banker, banker pays 0.95, pairs 11:1.
function betNet(zone, stake, r) {
  if (PAIRS.includes(zone)) return r.pairs?.[zone] ? stake * 11 : -stake;
  if (r.winner === 'TIE') return zone === 'TIE' ? stake * 8 : 0;
  if (zone !== r.winner) return -stake;
  return zone === 'BANKER' ? stake - Math.round(stake * 0.05 / 1e6) * 1e6 : stake; // the 5% commission, to the nearest 100만 (lib/games.mjs)
}

// What the AI regulars back this hand: a side (often following the last result) and now and then a pair.
function crowdPlan(last) {
  return (npc, t) => {
    const unit = t.tier.chips[0];
    const stake = Math.ceil(t.tier.min * (1 + Math.floor(Math.random() * (npc.bold > 0.6 ? 6 : 3))) / 2 / unit) * unit;
    const roll = Math.random();
    const zone = roll < 0.08 ? 'TIE' : last() && roll < 0.55 ? last() : roll < 0.78 ? 'BANKER' : 'PLAYER';
    const lines = {
      PLAYER: ['플레이어로 갈게요.', '이번엔 플레이어.'],
      BANKER: ['뱅커 따라갈게요.', '흐름은 뱅커예요.'],
      TIE: ['타이 한번 가 보죠.', '왠지 타이 느낌이에요.']
    };
    const bets = [{ zone, amount: Math.max(stake, t.tier.min), line: Math.random() < 0.4 ? lines[zone][Math.floor(Math.random() * 2)] : null }];
    if (Math.random() < 0.22) bets.push({ zone: Math.random() < 0.5 ? 'PLAYER_PAIR' : 'BANKER_PAIR', amount: unit * (1 + Math.floor(Math.random() * 2)), line: Math.random() < 0.5 ? '페어도 하나 걸게요.' : null });
    return bets;
  };
}

// `event: 'montecarlo'` seats the Monte Carlo Gala (lib/events.mjs): a bonus after three wins in a row.
export async function mountBaccarat(ctx, { event = null } = {}) {
  const ev = event ? eventInfo(ctx.state, event) : null;
  // Multi-zone for the pair side bets; the main bet still sits on exactly one of Player/Banker/Tie.
  const t = new Table({ ...ctx, game: 'baccarat', title: ev ? ev.title : 'Baccarat', feltClass: 'felt--blue', multi: true, zoneMin: false, zoneWord: '한 곳당', pushDouble: true });
  const don = createDoubleOrNothing(t);
  const meter = ev?.streak ? createStreakMeter(t, ev, ctx.state?.eventStreaks?.[ev.id] || 0) : null;
  if (ev) t.root.classList.add('is-event', `is-event--${ev.id}`);
  t.body.innerHTML = `
    <div class="bac">
      <div class="shoe" data-shoe aria-hidden="true"><span></span></div>
      <div class="discard" data-discard aria-hidden="true"></div>
      <div class="bac-sides">
        <section class="bac-side bac-side--player" data-side="PLAYER"><h3>Player</h3><div class="hand" data-hand></div><span class="bac-score" data-score>–</span></section>
        <section class="bac-side bac-side--banker" data-side="BANKER"><h3>Banker</h3><div class="hand" data-hand></div><span class="bac-score" data-score>–</span></section>
      </div>
      <div class="bac-bets">
        <div class="bac-pairs">
          <button type="button" class="zone zone--pair zone--player" data-zone="PLAYER_PAIR" aria-label="플레이어 페어, 11 대 1"><strong>P Pair</strong><small>11 : 1</small></button>
          <button type="button" class="zone zone--pair zone--banker" data-zone="BANKER_PAIR" aria-label="뱅커 페어, 11 대 1"><strong>B Pair</strong><small>11 : 1</small></button>
        </div>
        <div class="bac-zones">
          <button type="button" class="zone zone--player" data-zone="PLAYER"><strong>Player</strong><small>1 : 1</small></button>
          <button type="button" class="zone zone--tie" data-zone="TIE"><strong>Tie</strong><small>8 : 1</small></button>
          <button type="button" class="zone zone--banker" data-zone="BANKER"><strong>Banker</strong><small>0.95 : 1</small></button>
        </div>
      </div>
      <ol class="road" data-road aria-label="최근 결과"></ol>
    </div>`;
  t.body.querySelectorAll('[data-zone]').forEach(z => t.addZone(z));
  const shoe = t.body.querySelector('[data-shoe]');
  const discard = t.body.querySelector('[data-discard]');
  const side = s => t.body.querySelector(`[data-side="${s}"]`);
  const hand = s => side(s).querySelector('[data-hand]');
  const score = s => side(s).querySelector('[data-score]');
  const road = t.body.querySelector('[data-road]');
  let lastWinner = null;
  const crowd = seatCrowd(t, { plan: crowdPlan(() => lastWinner) });

  // Picking another side moves the main bet there, as before; the pair spots stack independently.
  const addChip = t.addChip.bind(t);
  t.addChip = async (zoneId, value, fromRect) => {
    if (t.locked || t.busy) return;
    const held = MAIN.includes(zoneId) && MAIN.find(z => z !== zoneId && t.chipsOf(z).length);
    if (held) await t.moveBet(held, zoneId);
    return addChip(zoneId, value, fromRect);
  };
  const mainZone = () => MAIN.find(z => t.chipsOf(z).length) || null;
  // Ready when the main bet meets the table minimum; pair bets ride along at any size.
  Object.defineProperty(t, 'betReady', {
    get() {
      const main = mainZone();
      return Boolean(main) && t.zoneTotal(main) >= t.tier.min && t.total <= t.available && t.betZones.every(z => t.zoneTotal(z) <= t.tier.max);
    }
  });

  function setScore(s) {
    const texts = [...hand(s).querySelectorAll('.card.is-faceup')].map(c => c.dataset.card);
    const node = score(s);
    node.textContent = texts.length ? point(texts) : '–';
    if (texts.length) animate(node, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, fill: 'none' });
  }

  function hit(zone) {
    const node = t.zones.get(zone);
    node?.classList.add('is-hit');
    setTimeout(() => node?.classList.remove('is-hit'), 2600);
  }

  function refreshActions() {
    t.setActions(t.idleActions('딜', deal));
  }
  t.refreshActions = refreshActions;
  t.onBetChange = () => {
    const main = mainZone();
    if (t.total && !main) t.hint('Player · Banker · Tie 중 하나에도 거세요');
    else if (main && t.zoneTotal(main) < t.tier.min) t.hint(`최소 ${formatCH(t.tier.min)}`);
    refreshActions();
  };

  async function deal() {
    if (!t.betReady) return;
    const betType = mainZone();
    const sideBets = Object.fromEntries(PAIRS.filter(z => t.zoneTotal(z)).map(z => [z, t.zoneTotal(z)]));
    const zones = t.betZones;
    t.lock();
    await Promise.all([
      crowd.close(),
      hand('PLAYER').children.length ? sweepCards([hand('PLAYER'), hand('BANKER')], discard) : null
    ]);
    ['PLAYER', 'BANKER'].forEach(s => { score(s).textContent = '–'; side(s).classList.remove('is-winner'); });
    let res;
    try { res = await api.baccarat(t.zoneTotal(betType), t.tier.floor, betType, Object.keys(sideBets).length ? sideBets : undefined, ev?.id); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    const r = res.round;
    // Deal P, B, P, B face down, then turn them — the bettor's side gets the slow squeeze.
    const nodes = { PLAYER: [], BANKER: [] };
    for (let i = 0; i < 2; i++) for (const s of ['PLAYER', 'BANKER']) nodes[s].push(await dealCard(hand(s), 'HIDDEN', shoe, { faceUp: false }));
    const order = betType === 'BANKER' ? ['PLAYER', 'BANKER'] : ['BANKER', 'PLAYER'];
    for (const s of order) {
      const texts = s === 'PLAYER' ? r.player : r.banker;
      const squeeze = s === betType;
      await wait(200);
      await flipCard(nodes[s][0], texts[0], { squeeze });
      await flipCard(nodes[s][1], texts[1], { squeeze });
      setScore(s);
      if (rankOf(texts[0]) === rankOf(texts[1])) hit(`${s}_PAIR`);
    }
    for (const s of ['PLAYER', 'BANKER']) {
      const texts = s === 'PLAYER' ? r.player : r.banker;
      if (texts.length > 2) {
        await wait(450);
        const third = await dealCard(hand(s), 'HIDDEN', shoe, { faceUp: false, rotate: true });
        await flipCard(third, texts[2], { squeeze: true });
        setScore(s);
      }
    }
    await wait(300);
    if (r.winner !== 'TIE') side(r.winner).classList.add('is-winner');
    lastWinner = r.winner === 'TIE' ? null : r.winner;
    const dot = document.createElement('li');
    dot.className = `road-dot road-dot--${r.winner.toLowerCase()}`;
    dot.textContent = r.winner === 'TIE' ? 'T' : r.winner[0];
    road.prepend(dot);
    while (road.children.length > 14) road.lastElementChild.remove();
    const net = r.netPnl;
    // Each spot is paid or raked on its own: the main bet, then each pair from the server's result.
    const nets = new Map(zones.map(z => [z, z === betType ? r.mainPnl ?? r.netPnl : r.sideBets?.find(b => b.betType === z)?.netPnl ?? betNet(z, t.zoneTotal(z), r)]));
    const pairs = PAIRS.filter(z => r.pairs?.[z]).map(z => (z === 'PLAYER_PAIR' ? 'P Pair' : 'B Pair'));
    const label = `${r.winner === 'TIE' ? 'Tie' : `${r.winner === 'PLAYER' ? 'Player' : 'Banker'} wins`}${pairs.length ? ` · ${pairs.join(' · ')}` : ''}`;
    voice.say(r.winner === 'TIE' ? 'tie' : r.winner === 'PLAYER' ? 'player-wins' : 'banker-wins');
    await Promise.all([t.settle(net, { label, zones: nets }), crowd.settle((zone, stake) => betNet(zone, stake, r))]);
    await t.syncBalance();
    crowd.open();
    if (res.eventStreak) await meter?.update(res.eventStreak);
    if (net > 0 && r.id) don.offer(r.id, net);
  }

  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });
  refreshActions();
  crowd.open();
  return t;
}
