// The Hold'em felt, shared by the solo table and friends' rooms: seats round an oval, cards
// pitched from the deck, bets pushed out and raked into the pot, the pot pushed to the winner.
// It replays the server's events one by one; the driver decides where they come from.
// `me` is the viewer's seat (always drawn at the bottom), or -1 for someone watching.
import { createCard, flipCard, setCardFace } from '../cards.js';
import { el, wait, formatCH, flyFrom, flyTo, animate, sound, haptic } from '../fx.js';
import { createChip, breakdown, TIERS } from '../chips.js';
import { voice, handLine, betLine } from '../voice.js';

export const STYLE_LABEL = { ROCK: '타이트', SHARK: '공격형', STATION: '콜링', MANIAC: '루즈' };
const ACT_LABEL = { FOLD: '폴드', CHECK: '체크', CALL: '콜', BET: '벳', RAISE: '레이즈', ALL_IN: '올인', SB: 'SB', BB: 'BB' };
// Big blind per table: a tenth of its smallest bet, and never under 2원 (lib/holdem-session.mjs).
export const BLINDS = Object.fromEntries(Object.values(TIERS).map(t => [t.slug, Math.max(2, t.min / 10)]));
const BIG_HANDS = new Set(['풀하우스', '포카드', '스트레이트 플러시']);
// Each bot temperament has its own voice at the table; it speaks up now and then, not every move.
const CHATTER = {
  ROCK: { RAISE: ['이번엔 들어갈게요.', '이 정도는 올려야죠.'], BET: ['조금 걸어 볼게요.'], ALL_IN: ['오래 기다렸어요. 올인.'], FOLD: ['이번 판은 쉴게요.', '전 빠질게요.'], CALL: ['받을게요.'], WIN: ['기다린 보람이 있네요.'], LOSE: ['역시 무리였어요.'], SHOWN: ['그 패로 거기까지요?', '접길 잘했네요.'] },
  SHARK: { RAISE: ['올리죠.', '다 보여요.'], BET: ['어디까지 따라오나 볼까요.'], ALL_IN: ['전부 걸죠.'], FOLD: ['이번엔 넘길게요.'], CALL: ['따라가 보죠.'], WIN: ['계산대로네요.'], LOSE: ['운이 좋으셨네요.'], SHOWN: ['기억해 둘게요.', '흥미롭네요.'] },
  STATION: { RAISE: ['어, 저도 올릴래요!'], BET: ['한번 가 볼까요?'], ALL_IN: ['에라, 모르겠다!'], FOLD: ['아, 아깝다…'], CALL: ['콜! 궁금하잖아요.', '일단 받을게요.', '구경만 할게요.'], WIN: ['받길 잘했다!'], LOSE: ['또 따라가 버렸네…'], SHOWN: ['아, 받을걸!', '그거였어요?'] },
  MANIAC: { RAISE: ['더 올려요!', '가즈아!'], BET: ['재미없잖아요, 걸죠.'], ALL_IN: ['쫄리면 죽든가!', '인생 한 방!'], FOLD: ['이번만 봐 드릴게요.'], CALL: ['콜, 콜!'], WIN: ['봤죠? 이게 포커예요.'], LOSE: ['다음 판에 두 배로 갚아 줄게요.'], SHOWN: ['약 올리시네.', '와, 그걸 보여 줘요?'] }
};
const pickLine = list => list?.[Math.floor(Math.random() * list.length)];
const RING = 2 * Math.PI * 15; // turn clock circumference (r = 15)

// Seats sit on an ellipse; k = 0 is the bottom.
function seatPoint(k, n) {
  const a = (90 + (k * 360) / n) * Math.PI / 180;
  return { x: 50 + 44 * Math.cos(a), y: 50 + 43 * Math.sin(a) };
}

export function createPokerFelt(t, { sitdown = '' } = {}) {
  voice.preload('poker');
  t.body.innerHTML = `
    <div class="pk">
      <div class="pk-oval" data-oval>
        <div class="pk-ring">
          <div class="pk-center">
            <div class="pk-deck" data-deck aria-hidden="true"></div>
            <div class="pk-board" data-board aria-label="공용 카드"></div>
            <div class="pk-pot" data-pot hidden><span class="pk-pot-stack" data-pot-stack></span><b data-pot-amount></b></div>
            <p class="pk-hint" data-hint-line>칩을 올려 바이인하고 자리에 앉으세요</p>
          </div>
          <div class="pk-seats" data-seats></div>
          <div class="pk-button" data-dealer-button aria-hidden="true">D</div>
        </div>
        <div class="pk-sitdown" data-sitdown>${sitdown}</div>
      </div>
    </div>`;
  const $ = s => t.body.querySelector(s);
  const seatsEl = $('[data-seats]'), boardEl = $('[data-board]'), deck = $('[data-deck]');
  const potEl = $('[data-pot]'), potStack = $('[data-pot-stack]'), potAmount = $('[data-pot-amount]');
  const dealerBtn = $('[data-dealer-button]');

  const pk = {
    oval: $('[data-oval]'), hintLine: $('[data-hint-line]'), sitdown: $('[data-sitdown]'),
    me: 0, seatEls: [], animating: false,
    bb: BLINDS[t.tier.slug] || BLINDS.corner,
    chipSet: null,
    // Plate text for a seat; drivers may replace it.
    nameOf: (i, s) => (i === pk.me ? '나' : s.name),
    noteOf: (i, s) => (s.kind === 'bot' ? STYLE_LABEL[s.style] || '' : ''),
    onEnd: null // (summary) => void, after the default banner
  };
  const setStakes = tier => { pk.bb = BLINDS[tier] || BLINDS.corner; pk.chipSet = [pk.bb, ...(TIERS[tier] || t.tier).chips.filter(v => v > pk.bb)]; };
  setStakes(t.tier.slug);
  pk.setStakes = setStakes;
  let potLeft = 0; // what is still in the middle while pots are being pushed out
  let handStart = null; // my stack when this hand was dealt, for the result banner
  let winners = [];
  let calledHand = false; // the winning hand is called once, even when side pots pay out again
  const shown = new Map(); // seat -> cards turned up at showdown
  let current = null; // last table view drawn
  const seatEls = pk.seatEls;

  // ---------- seats ----------
  const seatKey = s => `${s.kind}:${s.id ?? ''}`;
  pk.layoutKey = tb => tb.seats.map(seatKey).join('|');
  function buildSeats(tb) {
    const n = tb.seats.length;
    seatsEl.replaceChildren();
    seatEls.length = 0;
    tb.seats.forEach((s, i) => {
      const k = pk.me >= 0 ? (i - pk.me + n) % n : i;
      const p = seatPoint(k, n);
      const side = i !== pk.me && Math.abs(p.x - 50) > 20; // left/right of the board, not top or bottom
      const node = el('div', `pk-seat${i === pk.me ? ' pk-seat--hero' : ''}${side ? ` pk-seat--side pk-seat--${p.x < 50 ? 'l' : 'r'}` : ''}`);
      node.dataset.seat = i;
      node.style.setProperty('--x', p.x.toFixed(2));
      node.style.setProperty('--y', p.y.toFixed(2));
      node.innerHTML = `
        <div class="hand pk-cards" data-cards></div>
        <div class="pk-plate"><b data-name></b><span data-stack></span><small data-style></small><em class="pk-tag" data-tag></em></div>`;
      const bet = el('div', `pk-bet${side ? ' pk-bet--side' : ''}`);
      bet.style.setProperty('--x', (50 + (p.x - 50) * (side ? 0.3 : 0.55)).toFixed(2));
      bet.style.setProperty('--y', (k === 0 && pk.me >= 0 ? 88 : 50 + (p.y - 50) * 0.56).toFixed(2));
      bet.innerHTML = '<span class="pk-bet-stack"></span><b></b>';
      seatsEl.append(node, bet);
      seatEls.push({ node, bet, cards: node.querySelector('[data-cards]'), plate: node.querySelector('.pk-plate'), key: seatKey(s), stack: s.stack });
      paintSeat(i, s);
    });
    pk.layout = pk.layoutKey(tb);
  }
  function paintSeat(i, s) {
    const e = seatEls[i]; if (!e) return;
    const empty = s.kind === 'empty';
    e.node.querySelector('[data-name]').textContent = empty ? '빈 자리' : pk.nameOf(i, s);
    e.node.querySelector('[data-stack]').textContent = empty ? '' : formatCH(s.stack);
    e.node.querySelector('[data-style]').textContent = empty ? '' : pk.noteOf(i, s);
    e.stack = s.stack;
    e.node.classList.toggle('is-empty', empty);
    e.node.classList.toggle('is-human', s.kind === 'human' && i !== pk.me);
    e.node.classList.toggle('is-folded', Boolean(s.folded));
    e.node.classList.toggle('is-allin', Boolean(s.allIn));
    e.node.classList.toggle('is-out', !empty && s.stack <= 0 && !s.inHand);
  }
  function setStack(i, stack) { const e = seatEls[i]; if (!e) return; e.stack = stack; e.node.querySelector('[data-stack]').textContent = formatCH(stack); }
  function tag(i, text, kind = '') {
    const node = seatEls[i]?.node.querySelector('[data-tag]'); if (!node) return;
    node.textContent = text; node.className = `pk-tag${text ? ' is-shown' : ''}${kind ? ` is-${kind}` : ''}`;
  }
  function clearTags() { seatEls.forEach((_, i) => tag(i, '')); }
  // A speech bubble over a bot's seat.
  // One voice at a time: a bot only speaks up when nobody else has for a moment, so lines never
  // pile on top of each other while the table plays fast.
  let quietUntil = 0;
  function say(i, kind, chance = 0.4) {
    const seat = current?.seats?.[i];
    const node = seatEls[i]?.node;
    if (!seat || seat.kind !== 'bot' || i === pk.me || !node || Math.random() > chance) return;
    if (performance.now() < quietUntil && kind !== 'ALL_IN') return;
    const line = pickLine(CHATTER[seat.style]?.[kind]);
    if (!line) return;
    seatEls.forEach(s => s.node.querySelector('.pk-say')?.remove());
    quietUntil = performance.now() + 1800;
    const bubble = el('span', 'pk-say', line);
    node.append(bubble);
    setTimeout(() => bubble.remove(), 2000);
  }

  // Cards turned up after the hand for the table to see; the bots take it personally.
  async function showOff(i, cards = []) {
    const e = seatEls[i]; if (!e) return;
    // A folded hand went to the muck: lay it back down face up.
    if (!e.cards.querySelector('.card.is-faceup') && cards.length) e.cards.replaceChildren(...cards.map(text => createCard(text)));
    e.node.classList.add('is-showing');
    shown.set(i, shown.get(i) || [...e.cards.children].map(c => c.dataset.card));
    sound.flip();
    tag(i, '카드 공개', 'show');
    e.cards.classList.remove('is-showoff'); void e.cards.offsetWidth; e.cards.classList.add('is-showoff');
    const bots = (current?.seats || []).map((s, j) => (s?.kind === 'bot' && j !== i && seatEls[j] ? j : -1)).filter(j => j >= 0);
    const j = bots[Math.floor(Math.random() * bots.length)];
    if (j !== undefined) setTimeout(() => say(j, 'SHOWN', 0.8), 450);
    await wait(450);
  }

  function paintBet(i, amount) {
    const b = seatEls[i]?.bet; if (!b) return null;
    const stack = b.querySelector('.pk-bet-stack');
    b.dataset.amount = amount;
    b.classList.toggle('is-shown', amount > 0);
    b.querySelector('b').textContent = amount ? formatCH(amount) : '';
    const values = amount ? breakdown(amount, pk.chipSet, 6) : [];
    const have = stack.children.length;
    for (let k = have; k < values.length; k++) { const c = createChip(values[k]); c.style.setProperty('--i', k); stack.append(c); }
    while (stack.children.length > values.length) stack.lastElementChild.remove();
    return stack;
  }
  function paintPot(amount) {
    potLeft = amount;
    potEl.hidden = amount <= 0;
    potAmount.textContent = amount ? `POT ${formatCH(amount)}` : '';
    const values = amount ? breakdown(amount, pk.chipSet, 8) : [];
    potStack.replaceChildren(...values.map((v, k) => { const c = createChip(v); c.style.setProperty('--i', k); c.style.setProperty('--jx', `${(k % 3 - 1) * 5}px`); return c; }));
  }
  function moveButton(i) {
    const s = seatEls[i]; if (!s) return;
    const x = Number(s.node.style.getPropertyValue('--x')), y = Number(s.node.style.getPropertyValue('--y'));
    dealerBtn.style.setProperty('--x', (50 + (x - 50) * 0.6 + (x >= 50 ? -6 : 6)).toFixed(2));
    dealerBtn.style.setProperty('--y', (50 + (y - 50) * 0.6 + 4).toFixed(2));
    dealerBtn.classList.add('is-shown');
  }
  function markTurn(i) { seatEls.forEach((s, k) => s.node.classList.toggle('is-turn', k === i)); }

  // Instantly match the screen to a server table view (resume, or to correct any drift).
  function render(tb) {
    current = tb;
    if (seatEls.length !== tb.seats.length || pk.layout !== pk.layoutKey(tb)) buildSeats(tb);
    tb.seats.forEach((s, i) => {
      paintSeat(i, s);
      paintBet(i, s.bet);
      const box = seatEls[i].cards;
      const want = s.folded && !shown.has(i) ? [] : s.cards; // a folded hand stays mucked unless it was shown
      if (box.children.length !== want.length) box.replaceChildren(...want.map(c => createCard(c, { faceUp: c !== 'HIDDEN' })));
      else [...box.children].forEach((node, k) => { if (want[k] !== 'HIDDEN' && node.dataset.card !== want[k]) { setCardFace(node, want[k]); node.classList.add('is-faceup'); } });
    });
    if (boardEl.children.length > tb.board.length) boardEl.replaceChildren();
    for (let k = boardEl.children.length; k < tb.board.length; k++) boardEl.append(createCard(tb.board[k]));
    paintPot(tb.handOver ? 0 : tb.pot - tb.seats.reduce((a, s) => a + s.bet, 0));
    if (tb.handNo) moveButton(tb.button);
    markTurn(tb.toAct);
  }

  // ---------- event playback ----------
  const rectOf = node => node.getBoundingClientRect();
  async function pushChips(i, total) {
    const plate = seatEls[i].plate;
    const before = seatEls[i].bet.querySelector('.pk-bet-stack').children.length;
    const stack = paintBet(i, total);
    const fresh = [...stack.children].slice(before);
    sound.chip(); haptic(6);
    await Promise.all(fresh.map((c, k) => flyFrom(c, rectOf(plate), { duration: 340, delay: k * 40, lift: 26, spin: 30 })));
  }

  async function play(ev, tb) {
    const me = pk.me;
    switch (ev.t) {
      case 'seat': {
        const e = seatEls[ev.seat];
        paintSeat(ev.seat, { kind: 'bot', name: ev.name, style: ev.style, stack: ev.stack });
        e.cards.replaceChildren();
        await animate(e.node, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 380, fill: 'none' });
        break;
      }
      case 'hand': {
        clearTags();
        markTurn(-1);
        winners = [];
        shown.clear(); calledHand = false;
        handStart = me >= 0 && ev.seats.includes(me) ? seatEls[me]?.stack ?? null : null;
        seatEls.forEach((s, i) => { s.node.classList.remove('is-folded', 'is-allin', 'is-winner'); s.node.classList.toggle('is-out', !ev.seats.includes(i) && !s.node.classList.contains('is-empty')); paintBet(i, 0); s.node.querySelector('[data-hand-name]')?.remove(); s.cards.classList.remove('is-showoff'); s.node.classList.remove('is-showing'); });
        moveButton(ev.button);
        sound.tick();
        await wait(220);
        break;
      }
      case 'blind':
        setStack(ev.seat, ev.stack);
        tag(ev.seat, ACT_LABEL[ev.kind]);
        await pushChips(ev.seat, ev.bet);
        break;
      case 'deal': {
        const mine = tb?.seats?.[me]?.cards || [];
        const dealt = new Map(ev.order.map(i => [i, []]));
        for (let pass = 0; pass < 2; pass++) for (const i of ev.order) {
          const card = createCard('HIDDEN', { faceUp: false });
          seatEls[i].cards.append(card);
          dealt.get(i).push(card);
          sound.card();
          flyFrom(card, rectOf(deck), { duration: 380, spin: -40, scale: 0.6, lift: 14 });
          await wait(110);
        }
        await wait(300);
        if (dealt.has(me) && mine.length === 2 && !mine.includes('HIDDEN')) for (const [k, card] of dealt.get(me).entries()) await flipCard(card, mine[k], { duration: 340 });
        break;
      }
      case 'act': {
        // A bot thinks for a beat, and never talks over the dealer: it waits for him to finish.
        if (ev.seat !== me) { seatEls[ev.seat].node.classList.add('is-thinking'); markTurn(ev.seat); await Promise.all([wait(ev.timeout ? 200 : 380 + Math.random() * 320), voice.idle(900)]); seatEls[ev.seat].node.classList.remove('is-thinking'); }
        const label = ev.action === 'CALL' || ev.action === 'BET' || ev.action === 'RAISE' || ev.action === 'ALL_IN' ? `${ACT_LABEL[ev.action]}${ev.action === 'CALL' ? '' : ` ${formatCH(ev.bet)}`}` : ACT_LABEL[ev.action];
        tag(ev.seat, ev.timeout ? `시간 초과 · ${label}` : label, ev.action === 'FOLD' ? 'fold' : ev.action === 'ALL_IN' || ev.action === 'RAISE' || ev.action === 'BET' ? 'aggr' : '');
        say(ev.seat, ev.action, ev.action === 'ALL_IN' ? 0.9 : 0.35);
        // The dealer calls the action. Your own bets get their size ("Raise, two hundred thousand");
        // the bots get one word, and only when he is free, so the call-outs keep up with the table.
        if (ev.action === 'ALL_IN') voice.say('all-in', { cut: true });
        else if (ev.action === 'CHECK') voice.say('check', { drop: ev.seat !== me });
        else if (ev.action === 'CALL') voice.say('call', { drop: ev.seat !== me });
        else if (ev.seat === me) voice.say(betLine(ev.action, ev.bet));
        else if (ev.action === 'RAISE') voice.say('raise', { drop: true });
        if (ev.action === 'FOLD') {
          const cards = [...seatEls[ev.seat].cards.children];
          await Promise.all(cards.map((c, k) => flyTo(c, rectOf(deck), { duration: 360, delay: k * 50, fade: true })));
          seatEls[ev.seat].cards.replaceChildren();
          seatEls[ev.seat].node.classList.add('is-folded');
        } else if (ev.action === 'CHECK') {
          sound.tick(); sound.tick();
          animate(seatEls[ev.seat].plate, [{ transform: 'translateY(0)' }, { transform: 'translateY(2px)' }, { transform: 'translateY(0)' }], { duration: 200, fill: 'none' });
          await wait(200);
        } else {
          setStack(ev.seat, ev.stack);
          if (ev.stack === 0) seatEls[ev.seat].node.classList.add('is-allin');
          await pushChips(ev.seat, ev.bet);
        }
        break;
      }
      case 'collect': {
        markTurn(-1);
        await wait(250);
        const chips = seatEls.flatMap(s => [...s.bet.querySelectorAll('.chip')]);
        sound.chips(3);
        potEl.hidden = false;
        await Promise.all(chips.map((c, k) => flyTo(c, rectOf(potStack), { duration: 380, delay: k * 15, fade: true })));
        seatEls.forEach((_, i) => paintBet(i, 0));
        paintPot(ev.pot);
        clearTags();
        break;
      }
      case 'street': {
        voice.say(ev.street.toLowerCase());
        await wait(260);
        for (const text of ev.cards) {
          const card = createCard(text, { faceUp: false });
          boardEl.append(card);
          sound.card();
          await flyFrom(card, rectOf(deck), { duration: 340, spin: -20, scale: 0.7 });
        }
        for (const card of [...boardEl.children].filter(c => !c.classList.contains('is-faceup'))) await flipCard(card, card.dataset.card, { duration: 300 });
        break;
      }
      case 'show': {
        const box = seatEls[ev.seat].cards;
        if (ev.seat !== me || box.querySelector('.card:not(.is-faceup)')) {
          if (box.children.length !== ev.cards.length) box.replaceChildren(...ev.cards.map(() => createCard('HIDDEN', { faceUp: false })));
          for (const [k, node] of [...box.children].entries()) await flipCard(node, ev.cards[k], { duration: 320 });
        }
        shown.set(ev.seat, ev.cards);
        if (ev.voluntary) { await showOff(ev.seat, ev.cards); break; }
        const name = el('span', 'pk-handname', ev.hand);
        name.dataset.handName = '';
        seatEls[ev.seat].node.append(name);
        await wait(280);
        break;
      }
      case 'win': {
        const target = seatEls[ev.seat];
        target.node.classList.add('is-winner');
        winners.push(ev.seat);
        if (ev.hand && !calledHand) {
          calledHand = true;
          voice.say(handLine(ev.hand, [...(shown.get(ev.seat) || current?.seats?.[ev.seat]?.cards || []), ...[...boardEl.children].map(c => c.dataset.card)]));
        }
        const pay = breakdown(ev.amount, pk.chipSet, 8);
        const from = rectOf(potStack);
        paintPot(Math.max(0, potLeft - ev.amount));
        const flying = pay.map((v, k) => {
          const c = createChip(v);
          c.classList.add('pk-flying');
          document.body.append(c);
          const r = rectOf(target.plate);
          c.style.left = `${r.left + r.width / 2}px`; c.style.top = `${r.top + r.height / 2}px`;
          return flyFrom(c, from, { duration: 520, delay: k * 50, lift: 40 }).then(() => c.remove());
        });
        sound.chips(Math.min(pay.length, 6));
        if (ev.seat === me) { sound.win(); haptic([20, 60, 30]); t.glow(); }
        else say(ev.seat, 'WIN', 0.6);
        await Promise.all(flying);
        setStack(ev.seat, ev.stack);
        tag(ev.seat, ev.uncalled ? '반환' : `+${formatCH(ev.amount)}`, 'win');
        // A full house or better at showdown is a moment.
        if (ev.seat === me && BIG_HANDS.has(ev.hand)) await t.bigWin(ev.amount, { title: ev.hand, subtitle: "Hold'em" });
        break;
      }
      case 'end': {
        ev.stacks.forEach((s, i) => setStack(i, s));
        const net = handStart === null ? 0 : ev.stacks[me] - handStart;
        const names = [...new Set(winners)].map(i => (i === me ? '나' : pk.nameOf(i, current?.seats?.[i] || {})));
        const label = net > 0 ? 'You win' : names.length ? `${names.join(', ')} wins` : '';
        if (label || net) t.banner(label, net > 0 ? 'win' : net < 0 ? 'lose' : 'push', net);
        if (net > 0) voice.say('you-win');
        if (net < 0) sound.lose();
        pk.onEnd?.({ net, winners });
        await wait(500);
        break;
      }
      default: break;
    }
  }

  // Plays events in order, then snaps to the final view so nothing can drift.
  async function playEvents(events, tb, { snap = true } = {}) {
    pk.animating = true;
    if (tb) current = tb;
    try { for (const ev of events) await play(ev, tb); }
    finally { pk.animating = false; }
    if (snap && tb) render(tb);
  }

  async function sweep() {
    const cards = [...boardEl.children, ...seatEls.flatMap(s => [...s.cards.children])];
    await Promise.all(cards.map((c, k) => flyTo(c, rectOf(deck), { duration: 340, delay: k * 18, fade: true })));
    boardEl.replaceChildren();
    seatEls.forEach(s => { s.cards.replaceChildren(); s.node.classList.remove('is-winner'); s.node.querySelector('[data-hand-name]')?.remove(); });
    clearTags();
  }

  function clear() {
    seatsEl.replaceChildren(); seatEls.length = 0; pk.layout = null; current = null;
    boardEl.replaceChildren();
    paintPot(0);
    dealerBtn.classList.remove('is-shown');
    clock(-1);
  }

  // ---------- turn clock ----------
  // A ring round the acting seat's timer; `deadline` is in this device's clock.
  let clockTimer = null, clockNode = null;
  function clock(seat, deadline = 0, total = 25_000) {
    clearInterval(clockTimer);
    clockNode?.remove();
    clockNode = null;
    const host = seatEls[seat]?.plate;
    if (seat < 0 || !host) return;
    clockNode = el('span', 'pk-clock', `<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"/><circle class="pk-clock-run" cx="18" cy="18" r="15" stroke-dasharray="${RING.toFixed(2)}"/></svg><b></b>`);
    clockNode.setAttribute('role', 'timer');
    host.append(clockNode);
    const run = clockNode.querySelector('.pk-clock-run'), label = clockNode.querySelector('b');
    const node = clockNode;
    const paint = () => {
      const left = Math.max(0, deadline - Date.now());
      run.style.strokeDashoffset = (RING * (1 - left / total)).toFixed(2);
      label.textContent = Math.ceil(left / 1000);
      node.classList.toggle('is-low', left <= 5000);
      node.setAttribute('aria-label', `남은 시간 ${Math.ceil(left / 1000)}초`);
    };
    paint();
    clockTimer = setInterval(paint, 250);
  }

  pk.wasShown = i => shown.has(i);
  Object.assign(pk, { showOff, buildSeats, paintSeat, paintBet, paintPot, setStack, markTurn, render, play, playEvents, sweep, clear, clock, rectOf, moveButton, tag });
  return pk;
}

// The raise sizer and the fold / check-call / raise buttons for whoever holds the turn.
export function createActionBar(t, pk) {
  const sizer = el('div', 'pk-sizer');
  sizer.innerHTML = `
    <div class="pk-presets" role="group" aria-label="레이즈 크기" data-presets></div>
    <div class="pk-slider"><button type="button" data-step="-1" aria-label="줄이기">−</button><input type="range" data-range aria-label="레이즈 금액"><button type="button" data-step="1" aria-label="늘리기">+</button></div>`;
  t.root.querySelector('.table-controls').prepend(sizer);
  const range = sizer.querySelector('[data-range]'), presetsEl = sizer.querySelector('[data-presets]');
  let raiseTo = 0, shown = [];
  const bar = { sizer, legal: () => null, street: () => null, refresh: () => {} };

  const clampRaise = (l, value) => {
    const step = pk.bb / 2;
    return value >= l.maxRaiseTo ? l.maxRaiseTo : Math.max(l.minRaiseTo, Math.min(l.maxRaiseTo, Math.round(value / step) * step));
  };
  // Opening a pot before the flop sizes in big blinds; after that, or facing a raise, in pot fractions.
  function presetsFor(l) {
    const pot = f => l.currentBet + (l.pot + l.toCall) * f;
    const list = bar.street() === 'PREFLOP' && l.currentBet <= pk.bb
      ? [['2.5BB', 2.5 * pk.bb], ['3BB', 3 * pk.bb], ['4BB', 4 * pk.bb]]
      : [['⅓ 팟', pot(1 / 3)], ['½ 팟', pot(0.5)], ['¾ 팟', pot(0.75)], ['팟', pot(1)]];
    return [...list.map(([label, v]) => [label, clampRaise(l, v)]).filter(([, v]) => v < l.maxRaiseTo), ['올인', l.maxRaiseTo]];
  }
  function paintPresets() {
    presetsEl.style.setProperty('--n', shown.length);
    presetsEl.innerHTML = shown.map(([label, v], k) => `<button type="button" data-preset="${k}" aria-pressed="${v === raiseTo}">${label}</button>`).join('');
  }

  function setRaise(value) {
    const l = bar.legal(); if (!l) return;
    raiseTo = clampRaise(l, value);
    range.value = raiseTo;
    bar.refresh();
  }
  presetsEl.addEventListener('click', e => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    sound.tick();
    setRaise(shown[Number(b.dataset.preset)]?.[1] ?? raiseTo);
  });
  sizer.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => { sound.tick(); setRaise(raiseTo + Number(b.dataset.step) * pk.bb); }));
  range.addEventListener('input', () => setRaise(Number(range.value)));

  // The buttons for a legal turn; act(type, amount) sends the move.
  bar.actions = (l, act) => {
    sizer.hidden = !l.canRaise;
    if (l.canRaise) {
      range.min = l.minRaiseTo; range.max = l.maxRaiseTo; range.step = pk.bb / 2;
      if (raiseTo < l.minRaiseTo || raiseTo > l.maxRaiseTo) raiseTo = l.minRaiseTo;
      range.value = raiseTo;
      shown = presetsFor(l);
      paintPresets();
    }
    const allIn = raiseTo >= l.maxRaiseTo;
    return [
      { label: '폴드', key: 'F', ghost: !l.canCheck, onClick: () => act('FOLD') },
      l.canCheck ? { label: '체크', key: 'C', onClick: () => act('CHECK') } : { label: `콜 ${formatCH(l.toCall)}`, key: 'C', onClick: () => act('CALL') },
      ...(l.canRaise ? [{ label: allIn ? `올인 ${formatCH(raiseTo)}` : `${l.currentBet ? '레이즈' : '벳'} ${formatCH(raiseTo)}`, key: 'R', primary: true, onClick: () => (allIn ? act('ALL_IN') : act('RAISE', raiseTo)) }] : [])
    ];
  };

  // F / C / R on a turn, Enter for the primary button otherwise.
  t.onKey(e => {
    if (t.busy || pk.animating || bar.disabled?.()) return;
    const k = e.key.toLowerCase();
    if (bar.legal()) {
      const map = { f: 'F', c: 'C', r: 'R' };
      const a = map[k] && t.actionList.find(x => x.key === map[k]);
      if (a && !a.disabled) { e.preventDefault(); t.run(a.onClick); }
      return;
    }
    if (e.key === 'Enter' && !e.target.closest('button,input')) {
      const a = t.actionList.find(x => x.key === '↵');
      if (a && !a.disabled) { e.preventDefault(); t.run(a.onClick); }
    }
  });
  return bar;
}
