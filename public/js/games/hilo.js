// 하이로우: one 52-card deck. Call whether the next card is higher or lower; each right call
// raises the prize by the honest odds of that call on the cards still in the deck, and 챙기기
// takes it home. The server holds the deck (lib/hilo.mjs); this screen shows the card, what is
// left of each rank, and what each call pays in whole chips.
import { api, errorMessage } from '../api.js';
import { sound, haptic, wait, ms, flyFrom, rollNumber, el, formatCH, formatUnit, reducedMotion } from '../fx.js';
import { createCard, flipCard, cardBackClass } from '../cards.js';
import { Table } from '../table.js';
import { gameName } from '../names.js';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const ARROW = { HIGH: '▲', LOW: '▼' };
const rankOf = card => RANKS.indexOf(card.slice(0, -1)) + 1;

export async function mountHilo(ctx) {
  const t = new Table({ ...ctx, game: 'hilo', title: gameName('hilo'), feltClass: 'felt--hilo' });
  t.body.innerHTML = `
    <div class="hl" data-phase="bet">
      <ol class="hl-counts" data-counts aria-label="덱에 남은 카드"></ol>
      <div class="hl-trail" data-trail aria-label="지나간 카드"></div>
      <div class="hl-play">
        <button type="button" class="hl-call hl-call--high" data-call="HIGH" disabled>
          <span class="hl-call-head"><i aria-hidden="true">▲</i><strong data-label>높게</strong></span>
          <small data-note>같은 숫자도 맞음</small>
          <span class="hl-call-pay"><b data-pays>—</b><em data-chance></em></span>
        </button>
        <div class="hl-table">
          <div class="hl-slot" data-slot><div class="hl-ghost" aria-hidden="true">?</div></div>
          <div class="hl-deck" data-deck aria-hidden="true"><span class="${cardBackClass()}"></span><span class="${cardBackClass()}"></span><span class="${cardBackClass()}"></span><b data-left>52</b></div>
        </div>
        <button type="button" class="hl-call hl-call--low" data-call="LOW" disabled>
          <span class="hl-call-head"><i aria-hidden="true">▼</i><strong data-label>낮게</strong></span>
          <small data-note>같은 숫자도 맞음</small>
          <span class="hl-call-pay"><b data-pays>—</b><em data-chance></em></span>
        </button>
      </div>
      <div class="hl-prize" aria-live="polite">
        <span class="hl-prize-k" data-prize-k>칩을 놓고 시작하면 첫 카드가 열려요</span>
        <strong class="hl-prize-v" data-value hidden>0</strong>
        <span class="hl-streak" data-streak></span>
      </div>
      <button type="button" class="zone hl-bet" data-zone="BET"><strong>베팅</strong><small>맞힐 때마다 상금이 올라가요</small></button>
    </div>`;
  const root = t.body.querySelector('.hl');
  const countsEl = root.querySelector('[data-counts]');
  const trailEl = root.querySelector('[data-trail]');
  const slot = root.querySelector('[data-slot]');
  const deckEl = root.querySelector('[data-deck]');
  const leftEl = root.querySelector('[data-left]');
  const valueEl = root.querySelector('[data-value]');
  const prizeK = root.querySelector('[data-prize-k]');
  const streakEl = root.querySelector('[data-streak]');
  const callBtns = Object.fromEntries([...root.querySelectorAll('[data-call]')].map(b => [b.dataset.call, b]));
  t.addZone(root.querySelector('[data-zone="BET"]'));

  let round = null, cardNode = null, shown = 0;
  countsEl.replaceChildren(...RANKS.map(r => { const li = el('li', 'hl-count'); li.innerHTML = `<b>${r}</b><span><i></i><i></i><i></i><i></i></span>`; return li; }));

  function paintCounts(counts, current) {
    const cur = current ? rankOf(current) : 0;
    [...countsEl.children].forEach((li, i) => {
      const n = counts ? counts[i] : 4;
      li.querySelectorAll('i').forEach((dot, k) => dot.classList.toggle('is-gone', k >= n));
      li.classList.toggle('is-now', i + 1 === cur);
      li.classList.toggle('is-out', n === 0);
      li.setAttribute('aria-label', `${RANKS[i]} ${n}장`);
    });
    leftEl.textContent = counts ? counts.reduce((a, b) => a + b, 0) : 52;
  }

  function paintCalls() {
    const playing = round?.status === 'PLAYING';
    for (const [k, b] of Object.entries(callBtns)) {
      const o = round?.options?.[k];
      b.querySelector('[data-label]').textContent = o ? o.label : k === 'HIGH' ? '높게' : '낮게';
      b.querySelector('[data-note]').textContent = o ? o.note : '같은 숫자도 맞음';
      b.querySelector('[data-pays]').textContent = o && playing ? (o.open ? `맞히면 ${formatUnit(o.pays)}` : '상금 그대로') : '—';
      b.querySelector('[data-chance]').textContent = o && playing ? `${o.chance}%` : '';
      b.disabled = !playing || !o?.open || t.busy;
      b.setAttribute('aria-label', o && playing ? `${ARROW[k]} ${o.label}, ${o.note}, 확률 ${o.chance}%, ${o.open ? `맞히면 ${formatUnit(o.pays)}` : '상금이 늘지 않아요'}` : `${k === 'HIGH' ? '높게' : '낮게'}`);
    }
  }

  function paintPrize({ roll = false } = {}) {
    if (!round || round.status !== 'PLAYING') {
      prizeK.textContent = round ? '' : '칩을 놓고 시작하면 첫 카드가 열려요';
      valueEl.hidden = true; streakEl.textContent = '';
      return;
    }
    prizeK.textContent = round.wins ? '지금 챙기면' : '첫 번째 콜';
    valueEl.hidden = !round.wins;
    if (round.wins) {
      if (roll) rollNumber(valueEl, shown, round.value, { format: formatUnit });
      else valueEl.textContent = formatUnit(round.value);
      shown = round.value;
    }
    streakEl.textContent = round.wins ? `${round.wins}번 연속 적중` : '';
  }

  function paintTrail(list) {
    trailEl.replaceChildren(...list.slice(0, -1).slice(-10).map(step => {
      const c = createCard(step.card);
      c.classList.add('hl-mini');
      const wrap = el('span', `hl-step hl-step--${step.kind.toLowerCase()}`);
      wrap.append(c);
      if (step.call) wrap.append(el('i', 'hl-step-mark', ARROW[step.call]));
      return wrap;
    }));
  }

  function setCardNow(text) {
    slot.querySelector('.hl-ghost')?.remove();
    cardNode?.remove();
    cardNode = createCard(text);
    cardNode.classList.add('hl-card');
    slot.append(cardNode);
  }

  // A card comes off the deck face down and turns over; a call turns it slowly.
  async function deal(text, { squeeze = false } = {}) {
    if (cardNode) {
      // The card in play slides into the row of cards gone by.
      const old = cardNode; cardNode = null;
      old.classList.add('is-leaving');
      setTimeout(() => old.remove(), ms(260));
    }
    slot.querySelector('.hl-ghost')?.remove();
    const node = createCard(text, { faceUp: false });
    node.classList.add('hl-card');
    slot.append(node);
    cardNode = node;
    sound.card();
    await flyFrom(node, deckEl.getBoundingClientRect(), { duration: 320, lift: 30 });
    await flipCard(node, text, { duration: 340, squeeze: squeeze && !reducedMotion() });
  }

  function paint(next, { roll = false } = {}) {
    round = next;
    root.dataset.phase = round?.status === 'PLAYING' ? 'play' : 'bet';
    paintCounts(round?.counts || null, round?.card);
    paintCalls();
    paintPrize({ roll });
    if (round) paintTrail(round.trail || []);
    refreshActions();
  }

  function refreshActions() {
    if (round?.status === 'PLAYING') {
      t.setActions([
        { label: `넘기기 ${round.skips}`, ghost: true, disabled: !round.skips || !round.left, onClick: () => move('SKIP') },
        { label: round.wins ? `챙기기 ${formatUnit(round.value)}` : '챙기기', key: '↵', primary: true, disabled: !round.wins, onClick: () => move('CASH') }
      ]);
    } else t.setActions(t.idleActions('시작', go));
    paintCalls();
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  async function go() {
    if (!t.betReady) return;
    const stake = t.total, key = t.roundKey();
    t.lock();
    let res;
    try { res = await api.hiloStart(stake, t.tier.floor, key); }
    catch (e) { t.roundFailed(e, go); refreshActions(); return; }
    t.roundDone();
    t.setServerState(res.state);
    trailEl.replaceChildren();
    shown = 0;
    round = res.round;
    root.dataset.phase = 'play';
    paintCounts(null, null);
    await deal(res.round.card);
    paint(res.round);
  }

  async function move(kind) {
    if (!round || round.status !== 'PLAYING') return;
    const before = round;
    if (kind !== 'CASH') Object.values(callBtns).forEach(b => { b.disabled = true; });
    if (kind === 'HIGH' || kind === 'LOW') callBtns[kind].classList.add('is-picked');
    let res;
    try { res = await api.hiloMove(before.id, kind, before.seq); }
    catch (e) { callBtns[kind]?.classList.remove('is-picked'); t.toast(errorMessage(e)); paint(before); return; }
    t.setServerState(res.state);
    const ev = res.event, next = res.round;
    if (!ev) { paint(next); return; } // a step already played: just catch up
    if (ev.type === 'skip') { await deal(ev.card); paint(next); return; }
    if (ev.type === 'hit' || ev.type === 'miss') {
      await deal(ev.card, { squeeze: true });
      callBtns[kind].classList.remove('is-picked');
      if (ev.type === 'hit') {
        sound.chip(); haptic([10, 30, 10]);
        cardNode?.classList.add('is-hit');
        paint(next, { roll: true });
        if (next.status === 'PLAYING') return;
      } else {
        cardNode?.classList.add('is-miss');
        paint(next);
      }
    } else paint(next);
    await finish(next);
  }

  async function finish(done) {
    const net = done.netPnl ?? ((done.result?.value ?? 0) - done.stake);
    const label = done.result?.kind === 'MISS' ? `${done.card} · 빗나갔어요` : done.result?.kind === 'MAX' ? '최고 상금 1000배' : `${done.wins}번 맞혀 챙겼어요`;
    await t.settle(net, { label });
    await t.syncBalance();
    round = null;
    paint(null);
    prizeK.textContent = '칩을 놓고 다시 시작해요';
  }

  for (const [k, b] of Object.entries(callBtns)) b.addEventListener('click', () => t.run(() => move(k)));
  t.onKey(e => {
    if (t.busy || e.target.closest?.('input,textarea')) return;
    if (round?.status === 'PLAYING' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const k = e.key === 'ArrowUp' ? 'HIGH' : 'LOW';
      if (!callBtns[k].disabled) { e.preventDefault(); t.run(() => move(k)); }
      return;
    }
    const a = e.key === 'Enter' && !e.target.closest('button') && t.enterAction();
    if (a) { e.preventDefault(); t.run(a.onClick); }
  });

  // An unfinished round (the app closed mid-ladder) picks up where it was.
  try {
    const open = await api.hiloOpen();
    if (open.round?.status === 'PLAYING') {
      t.placeLocked('BET', open.round.stake);
      t.lock();
      t.refreshBet();
      setCardNow(open.round.card);
      shown = open.round.value;
      paint(open.round);
      t.toast('하던 판을 이어서 해요');
      return t;
    }
  } catch {}
  paint(null);
  return t;
}
