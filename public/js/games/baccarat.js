// Baccarat: back a side, then watch the cards get squeezed and the third-card rule play out.
import { api, errorMessage } from '../api.js';
import { dealCard, flipCard, sweepCards, parseCard } from '../cards.js';
import { wait, formatCH, animate } from '../fx.js';
import { Table } from '../table.js';

const point = texts => texts.reduce((s, t) => { const c = parseCard(t); if (!c) return s; return s + (c.rank === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 0 : Number(c.rank)); }, 0) % 10;

export async function mountBaccarat(ctx) {
  const t = new Table({ ...ctx, game: 'baccarat', title: 'BACCARAT', feltClass: 'felt--blue' });
  t.body.innerHTML = `
    <div class="bac">
      <div class="shoe" data-shoe aria-hidden="true"><span></span></div>
      <div class="discard" data-discard aria-hidden="true"></div>
      <div class="bac-sides">
        <section class="bac-side bac-side--player" data-side="PLAYER"><h3>PLAYER</h3><div class="hand" data-hand></div><span class="bac-score" data-score>–</span></section>
        <section class="bac-side bac-side--banker" data-side="BANKER"><h3>BANKER</h3><div class="hand" data-hand></div><span class="bac-score" data-score>–</span></section>
      </div>
      <div class="bac-zones">
        <button type="button" class="zone zone--player" data-zone="PLAYER"><strong>PLAYER</strong><small>1 : 1</small></button>
        <button type="button" class="zone zone--tie" data-zone="TIE"><strong>TIE</strong><small>8 : 1</small></button>
        <button type="button" class="zone zone--banker" data-zone="BANKER"><strong>BANKER</strong><small>0.95 : 1</small></button>
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

  function setScore(s) {
    const texts = [...hand(s).querySelectorAll('.card.is-faceup')].map(c => c.dataset.card);
    const node = score(s);
    node.textContent = texts.length ? point(texts) : '–';
    if (texts.length) animate(node, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, fill: 'none' });
  }

  function refreshActions() {
    t.setActions([
      { label: '지우기', ghost: true, disabled: !t.total, onClick: () => t.clearBet() },
      ...(t.lastBet ? [{ label: '다시 베팅', ghost: true, onClick: () => t.rebet() }] : []),
      { label: '딜', key: '↵', primary: true, disabled: !t.betReady, onClick: deal }
    ]);
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  async function deal() {
    if (!t.betReady) return;
    const betType = t.bet.zone;
    t.lock();
    if (hand('PLAYER').children.length) await sweepCards([hand('PLAYER'), hand('BANKER')], discard);
    ['PLAYER', 'BANKER'].forEach(s => { score(s).textContent = '–'; side(s).classList.remove('is-winner'); });
    let res;
    try { res = await api.baccarat(t.total, t.tier.floor, betType); }
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
    const dot = document.createElement('li');
    dot.className = `road-dot road-dot--${r.winner.toLowerCase()}`;
    dot.textContent = r.winner === 'TIE' ? 'T' : r.winner[0];
    road.prepend(dot);
    while (road.children.length > 14) road.lastElementChild.remove();
    const net = r.netPnl;
    const label = `${r.winner === 'TIE' ? 'TIE' : `${r.winner} WINS`}${net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : ''}`;
    await t.settle(net, { label });
    await t.syncBalance();
  }

  t.onKey(e => { if (!t.busy && e.key === 'Enter' && t.betReady && !e.target.closest('button')) { e.preventDefault(); t.run(deal); } });
  refreshActions();
  return t;
}
