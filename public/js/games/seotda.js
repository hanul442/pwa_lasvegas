// 섯다: one card, a betting round, a second card squeezed open, a last round, then both hands
// are turned over. The house AI matches the ante and bets from its own two cards only.
import { api, errorMessage } from '../api.js';
import { createHwatu, flipHwatu } from '../hwatu.js';
import { animate, flyFrom, flyTo, wait, sound, haptic, formatCH, el } from '../fx.js';
import { breakdown, createChip } from '../chips.js';
import { Table } from '../table.js';

const ME = 0, OPP = 1;
const LABEL = { DIE: '다이', CHECK: '체크', BBING: '삥', HALF: '하프', CALL: '콜' };

export async function mountSeotda(ctx) {
  const t = new Table({ ...ctx, game: 'seotda', title: '섯다', feltClass: 'felt--seotda' });
  t.body.innerHTML = `
    <div class="sd">
      <section class="sd-seat sd-seat--opp" data-seat="1">
        <div class="sd-meta"><span class="mg-name">하우스 AI</span><span class="sd-said" data-said="1"></span></div>
        <div class="sd-cards sd-cards--opp" data-cards="1"></div>
        <span class="sd-hand-name" data-name="1"></span>
      </section>
      <div class="sd-pot">
        <div class="mg-pile sd-deck" data-deck aria-hidden="true"></div>
        <button type="button" class="zone sd-zone" data-zone="ANTE"><strong>판돈</strong><small>나와 AI가 똑같이 걸고 시작</small></button>
        <div class="sd-pot-amount" data-pot></div>
      </div>
      <section class="sd-seat sd-seat--me" data-seat="0">
        <span class="sd-hand-name" data-name="0"></span>
        <div class="sd-cards" data-cards="0"></div>
        <div class="sd-meta"><span class="mg-name">나</span><span class="sd-said" data-said="0"></span></div>
      </section>
    </div>`;
  const $ = s => t.body.querySelector(s);
  const zone = t.addZone($('[data-zone="ANTE"]'));
  const deck = $('[data-deck]');
  deck.append(createHwatu(null, { faceUp: false }));
  const cardsOf = seat => $(`[data-cards="${seat}"]`);
  const potEl = $('[data-pot]');
  let view = null;
  t.sd = { get view() { return view; } };

  function oppStack() {
    let s = zone.querySelector('.bet-stack--payout');
    if (!s) { s = el('span', 'bet-stack bet-stack--payout'); zone.append(s); }
    return s;
  }

  function paintPot(v) {
    potEl.innerHTML = v ? `${formatCH(v.pot)}<small>판 · 내가 건 돈 ${formatCH(v.contrib[ME])}</small>` : '';
  }

  function say(seat, action, cost) {
    const node = $(`[data-said="${seat}"]`);
    node.innerHTML = `<b>${LABEL[action]}</b>${cost ? ` ${formatCH(cost)}` : ''}`;
    animate(node, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, fill: 'none' });
  }

  async function dealTo(seat, id, { squeeze = false } = {}) {
    const node = createHwatu(id && id !== 'HIDDEN' ? id : null, { faceUp: false });
    cardsOf(seat).append(node);
    sound.card(); haptic(6);
    await flyFrom(node, deck.getBoundingClientRect(), { duration: 420, spin: -16, scale: 0.7, lift: 26 });
    if (seat === ME && id && id !== 'HIDDEN') await flipHwatu(node, id, { squeeze });
    return node;
  }

  async function oppChips(cost) {
    if (!cost) return;
    const stack = oppStack();
    const from = cardsOf(OPP).getBoundingClientRect();
    sound.chips(2);
    for (const v of breakdown(cost, t.tier.chips, 6)) {
      const c = createChip(v);
      c.style.setProperty('--i', stack.children.length);
      stack.append(c);
      flyFrom(c, from, { duration: 360, lift: 30 });
      await wait(60);
    }
  }

  async function playEvents(events) {
    for (const e of events) {
      if (e.type === 'bet') {
        if (e.seat === OPP) await wait(600);
        say(e.seat, e.action, e.cost);
        if (e.cost) { if (e.seat === ME) await t.addFromTray('ANTE', e.cost); else await oppChips(e.cost); }
        else sound.tick();
        if (e.action === 'DIE') cardsOf(e.seat).querySelectorAll('.hw').forEach(n => animate(n, [{ opacity: 1 }, { opacity: 0.35, transform: 'translateY(8px)' }], { duration: 300 }));
        potEl.firstChild && (potEl.firstChild.textContent = formatCH(e.pot));
        await wait(220);
      } else if (e.type === 'deal') {
        await dealTo(e.seat, e.card, { squeeze: e.seat === ME });
      } else if (e.type === 'reveal') {
        await wait(400);
        const opp = [...cardsOf(OPP).querySelectorAll('.hw')];
        for (let i = 0; i < opp.length; i++) await flipHwatu(opp[i], e.hands[OPP][i], { squeeze: i === 1 });
      }
    }
  }

  function paintNames(v) {
    $('[data-name="0"]').textContent = v?.handName || '';
    $('[data-name="1"]').textContent = v?.result?.hands?.[OPP] || '';
  }

  async function apply(res) {
    t.setServerState(res.state);
    view = res.round;
    await playEvents(res.events || []);
    paintPot(view);
    paintNames(view);
    t.syncBalance();
    if (view.status === 'SETTLED') await finish(view, res.netPnl || 0);
  }

  async function finish(v, net) {
    const r = v.result;
    const names = r.hands.filter(Boolean);
    const label = r.reason === 'REDEAL' ? '구사 · 재경기 (판돈 돌려받음)'
      : r.reason === 'TIE' ? '무승부 · 판돈 돌려받음'
      : r.reason === 'FOLD' ? (r.winner === ME ? 'AI 다이 · 승리' : '다이')
      : `${r.winner === ME ? '승리' : '패배'} · ${r.hands[r.winner]}`;
    if (names.length === 2) t.toast(`나 ${r.hands[ME]} · AI ${r.hands[OPP]}`);
    t.banner(`${label}${net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : ''}`, net > 0 ? 'win' : net < 0 ? 'lose' : 'push');
    if (net > 0) { sound.win(); haptic([20, 60, 30]); t.glow(); } else if (net < 0) { sound.lose(); haptic(30); } else sound.push();
    await wait(900);
    // The whole pot slides to whoever took it; a split sends each stack home.
    const mine = [...(t.stackOf('ANTE')?.children || [])];
    const theirs = [...oppStack().children];
    const toMe = t.balanceEl.getBoundingClientRect(), toOpp = cardsOf(OPP).getBoundingClientRect();
    const dest = c => (net > 0 ? toMe : net < 0 ? toOpp : mine.includes(c) ? toMe : toOpp);
    sound.chips(3);
    await Promise.all([...mine, ...theirs].map((c, i) => flyTo(c, dest(c), { duration: 440, delay: i * 25, lift: 40, fade: true })));
    t.resetRound();
    await t.syncBalance();
    refreshActions();
  }

  async function deal() {
    if (!t.betReady) return;
    t.lock();
    let res;
    try { res = await api.seotdaStart(t.total, t.tier.floor); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    [ME, OPP].forEach(s => { cardsOf(s).replaceChildren(); $(`[data-said="${s}"]`).textContent = ''; });
    paintNames(null);
    await oppChips(res.round.stake);
    view = res.round;
    paintPot(view);
    const order = view.first === ME ? [ME, OPP] : [OPP, ME];
    for (const s of order) await dealTo(s, s === ME ? view.hand[0] : 'HIDDEN');
    // A second card already on the table means both seats saw street one play out.
    await playEvents(res.events || []);
    paintPot(view);
    paintNames(view);
    await t.syncBalance();
    if (view.status === 'SETTLED') await finish(view, res.netPnl || 0);
  }

  function refreshActions() {
    if (!view || view.status !== 'PLAYING') {
      t.setActions([
        { label: '지우기', ghost: true, disabled: !t.total, onClick: () => t.clearBet() },
        ...(t.lastBet ? [{ label: '다시 베팅', ghost: true, onClick: () => t.rebet() }] : []),
        { label: '시작', key: '↵', primary: true, disabled: !t.betReady, onClick: deal }
      ]);
      return;
    }
    if (view.turn !== ME) { t.setActions([{ label: 'AI 차례', ghost: true, disabled: true }]); return; }
    const opts = view.options;
    t.hint(view.street === 1 ? '첫 장을 보고 베팅해요' : '마지막 베팅이에요');
    t.setActions(opts.map(o => ({
      label: `${LABEL[o.action]}${o.cost ? ` ${formatCH(o.cost)}` : ''}`,
      ghost: o.action === 'DIE',
      primary: o.action === 'CALL' || (o.action === 'CHECK' && !opts.some(x => x.action === 'CALL')),
      disabled: o.cost > t.available,
      onClick: () => act(o.action)
    })));
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  async function act(action) {
    t.hint('');
    let res;
    try { res = await api.seotdaAction(view.id, action); }
    catch (e) { t.toast(errorMessage(e)); return; }
    await apply(res);
  }

  t.onKey(e => { if (!t.busy && e.key === 'Enter' && (!view || view.status !== 'PLAYING') && t.betReady && !e.target.closest('button')) { e.preventDefault(); t.run(deal); } });

  try {
    const open = await api.seotdaOpen();
    if (open.round && (!open.floor || open.floor === t.tier.floor)) {
      view = open.round;
      t.lock();
      t.bet = { zone: 'ANTE', chips: breakdown(view.contrib[ME], t.tier.chips, 12) };
      t.bet.chips.forEach(v => t.pushChip('ANTE', v)); t.refreshBet();
      breakdown(view.contrib[OPP], t.tier.chips, 12).forEach((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); oppStack().append(c); });
      view.hand.forEach(id => cardsOf(ME).append(createHwatu(id)));
      view.opponent.forEach(() => cardsOf(OPP).append(createHwatu(null, { faceUp: false })));
      paintPot(view);
      paintNames(view);
      t.toast('하던 섯다 판을 이어서 해요');
    } else if (open.round) t.toast('다른 테이블에 진행 중인 섯다 판이 있어요');
  } catch {}
  refreshActions();
  return t;
}
