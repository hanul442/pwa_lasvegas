// The Hold'em felt, shared by the solo table and friends' rooms: seats round an oval, cards
// pitched from the deck, bets pushed out and raked into the pot, the pot pushed to the winner.
// It replays the server's events one by one; the driver decides where they come from.
// `me` is the viewer's seat (always drawn at the bottom), or -1 for someone watching.
import { createCard, flipCard, setCardFace } from '../cards.js';
import { el, wait, formatCH, flyFrom, flyTo, animate, sound, haptic } from '../fx.js';
import { createChip, breakdown, holding, TIERS } from '../chips.js';
import { voice, handLine, betLine } from '../voice.js';
import { handName } from '../poker-hand.js';
import { riffle } from '../dealer.js';
import { buzz } from '../haptics.js';

export const STYLE_LABEL = { ROCK: '타이트', SHARK: '공격형', STATION: '콜링', MANIAC: '루즈' };
// 7포커 (sevenpoker.js) plays on this felt too, with its Korean bet sizes and the ante.
const ACT_LABEL = { FOLD: '폴드', CHECK: '체크', CALL: '콜', BET: '벳', RAISE: '레이즈', ALL_IN: '올인', SB: 'SB', BB: 'BB', ANTE: '앤티', BBING: '삥', DDADANG: '따당', QUARTER: '쿼터', HALF: '하프' };
// Moves that put a new size on the table: the tag shows the amount and lights up.
const SIZED = new Set(['BET', 'RAISE', 'ALL_IN', 'BBING', 'DDADANG', 'QUARTER', 'HALF']);
// Big blind per table: a tenth of its smallest bet in 200만s, never under 200만 (lib/holdem-session.mjs).
export const BLINDS = Object.fromEntries(Object.values(TIERS).map(t => [t.slug, Math.max(2_000_000, Math.round(t.min / 10 / 2_000_000) * 2_000_000)]));
const STACK_MAX = 6; // chips in the tower beside each player's plate
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
  // Burnt cards: one face down beside the deck before each street, swept with the rest.
  const burn = el('div', 'pk-burn');
  burn.setAttribute('aria-hidden', 'true');
  deck.after(burn);
  let handsDealt = 0;
  // A card lands a little off square, the way a pitched card does.
  const toss = card => card.style.setProperty('--tilt', `${(Math.random() * 7 - 3.5).toFixed(1)}deg`);
  const dealerBtn = $('[data-dealer-button]');

  const pk = {
    oval: $('[data-oval]'), hintLine: $('[data-hint-line]'), sitdown: $('[data-sitdown]'),
    me: 0, seatEls: [], animating: false,
    bb: BLINDS[t.tier.slug] || BLINDS[Object.keys(BLINDS)[0]],
    chipSet: null,
    // What my own plate says ('나', or a friend's name while watching their chair).
    meName: '나',
    // Plate text for a seat; drivers may replace it.
    nameOf: (i, s) => (i === pk.me ? pk.meName : s.name),
    noteOf: (i, s) => (s.kind === 'bot' ? STYLE_LABEL[s.style] || '' : ''),
    onEnd: null, // (summary) => void, after the default banner
    labels: { ...ACT_LABEL }, // what each move is called on a seat's tag; drivers may rename them
    gameLabel: '홀덤', // the big-win card's subtitle
    paintHands: null // () => void, replaces the hero's hand-name pill (7포커 reads seven cards)
  };
  const setStakes = tier => { pk.bb = BLINDS[tier] || BLINDS[Object.keys(BLINDS)[0]]; pk.chipSet = [pk.bb, ...(TIERS[tier] || t.tier).chips.filter(v => v > pk.bb)]; };
  setStakes(t.tier.slug);
  pk.setStakes = setStakes;
  let potLeft = 0; // what is still in the middle while pots are being pushed out
  let handStart = null; // my stack when this hand was dealt, for the result banner
  let winners = [];
  let calledHand = false; // the winning hand is called once, even when side pots pay out again
  let lastStanding = false; // this hand was won without a showdown, everyone else folded
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
        <div class="pk-plate"><b data-name></b><span data-stack></span><small data-style></small><i class="pk-myhand" data-myhand></i><em class="pk-tag" data-tag></em><span class="pk-stack" data-chips aria-hidden="true"></span></div>`;
      const bet = el('div', `pk-bet${side ? ` pk-bet--side${p.y > 50 ? ' pk-bet--low' : ''}` : i !== pk.me && p.y < 50 ? ' pk-bet--top' : ''}`);
      bet.style.setProperty('--sx', p.x.toFixed(2)); // the seat's own spot, for layouts that place bets their own way
      bet.style.setProperty('--sy', p.y.toFixed(2));
      bet.style.setProperty('--x', (50 + (p.x - 50) * (side ? (p.y > 50 ? 0.1 : 0.25) : 0.55)).toFixed(2));
      bet.style.setProperty('--y', (k === 0 && pk.me >= 0 ? 88 : 50 + (p.y - 50) * (side ? (p.y > 50 ? 1.3 : 0.56) : 0.45)).toFixed(2));
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
    paintChips(e, empty ? 0 : s.stack);
    e.node.classList.toggle('is-empty', empty);
    e.node.classList.toggle('is-human', s.kind === 'human' && i !== pk.me);
    e.node.classList.toggle('is-folded', Boolean(s.folded));
    e.node.classList.toggle('is-allin', Boolean(s.allIn));
    e.node.classList.toggle('is-out', !empty && s.stack <= 0 && !s.inHand);
  }
  function setStack(i, stack) { const e = seatEls[i]; if (!e) return; e.stack = stack; e.node.querySelector('[data-stack]').textContent = formatCH(stack); paintChips(e, stack); }
  // What my two cards make with the board so far ("원페어", "플러시"…), always on my plate.
  function paintMyHand() {
    if (pk.paintHands) return pk.paintHands();
    const e = seatEls[pk.me]; if (!e) return;
    const up = box => [...box.children].filter(c => c.classList.contains('is-faceup')).map(c => c.dataset.card);
    const mine = up(e.cards);
    const node = e.node.querySelector('[data-myhand]');
    const text = mine.length === 2 ? handName([...mine, ...up(boardEl)]) : '';
    if (node.textContent !== text) node.textContent = text;
  }
  // What each player has left, as one small tower of the table's chips beside their plate:
  // the biggest chips at the bottom, a few smaller ones on top, never taller than STACK_MAX.
  function paintChips(e, amount) {
    const box = e.node.querySelector('[data-chips]');
    const set = pk.chipSet || [pk.bb];
    const key = `${amount}:${set.join(',')}`;
    if (!box || box.dataset.key === key) return;
    box.dataset.key = key;
    const counts = amount > 0 ? holding(amount, set) : [];
    const tower = [];
    for (let k = set.length - 1; k >= 0 && tower.length < STACK_MAX; k--) for (let j = 0; j < (counts[k] || 0) && tower.length < STACK_MAX; j++) tower.push(set[k]);
    box.style.setProperty('--n', tower.length);
    box.replaceChildren(...tower.map((v, j) => { const c = createChip(v); c.style.setProperty('--i', j); return c; }));
  }
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
    potStack.replaceChildren(...values.map((v, k) => { const c = createChip(v); c.style.setProperty('--i', k); c.style.setProperty('--jx', `${(k % 3 - 1) * 2}px`); return c; }));
  }
  // The dealer button sits on the corner of the dealer's plate, so it never lands on the board.
  function moveButton(i) {
    const s = seatEls[i]; if (!s) return;
    if (dealerBtn.parentNode !== s.plate) s.plate.append(dealerBtn);
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
    paintMyHand();
  }

  // ---------- heads-up ----------
  // When a hand comes down to two players the table changes key: everyone else dims, the two
  // seats are lit, the felt starts to pulse like a heartbeat, the bots take a breath longer, and
  // the turn and river are squeezed open slowly.
  let inHand = new Set();
  let duel = false;
  function enterDuel({ announce = true } = {}) {
    if (duel || inHand.size !== 2) return;
    duel = true;
    const [a, b] = [...inHand];
    pk.oval.classList.add('is-duel');
    [a, b].forEach(i => seatEls[i]?.node.classList.add('is-duelist'));
    if (!announce) return;
    const nameOf = i => (i === pk.me ? pk.meName : pk.nameOf(i, current?.seats?.[i] || {}));
    const flash = el('div', 'pk-duel', `<b>HEADS-UP</b><small>${nameOf(a)} vs ${nameOf(b)}</small>`);
    flash.setAttribute('role', 'status');
    pk.oval.append(flash);
    sound.tick(); setTimeout(() => sound.tick(), 140);
    haptic([30, 80, 30]);
    setTimeout(() => flash.remove(), 1700);
  }
  function leaveDuel() {
    duel = false;
    pk.oval.classList.remove('is-duel');
    seatEls.forEach(s => s.node.classList.remove('is-duelist'));
  }

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
        shown.clear(); calledHand = false; lastStanding = false;
        leaveDuel();
        inHand = new Set(ev.seats);
        handStart = me >= 0 && ev.seats.includes(me) ? seatEls[me]?.stack ?? null : null;
        seatEls.forEach((s, i) => { s.node.classList.remove('is-folded', 'is-allin', 'is-winner'); s.node.classList.toggle('is-out', !ev.seats.includes(i) && !s.node.classList.contains('is-empty')); paintBet(i, 0); s.node.querySelector('[data-hand-name]')?.remove(); s.cards.classList.remove('is-showoff'); s.node.classList.remove('is-showing'); });
        moveButton(ev.button);
        enterDuel({ announce: false });
        sound.tick();
        await wait(220);
        break;
      }
      case 'blind':
        setStack(ev.seat, ev.stack);
        tag(ev.seat, pk.labels[ev.kind]);
        await pushChips(ev.seat, ev.bet);
        break;
      case 'deal': {
        const mine = tb?.seats?.[me]?.cards || [];
        const dealt = new Map(ev.order.map(i => [i, []]));
        // A full riffle at the first hand and every fifth after; between, a quick square-up.
        if (handsDealt++ % 5 === 0) await riffle(t.felt, { shoe: deck, at: boardEl.getBoundingClientRect() });
        else { sound.shuffle(); await animate(deck, [{ transform: 'none' }, { transform: 'translateY(2px) scale(.96)' }, { transform: 'none' }], { duration: 260, fill: 'none' }); await wait(160); }
        for (let pass = 0; pass < 2; pass++) for (const i of ev.order) {
          const card = createCard('HIDDEN', { faceUp: false });
          if (i !== me) toss(card);
          seatEls[i].cards.append(card);
          dealt.get(i).push(card);
          sound.card(); if (i === me) buzz('card');
          flyFrom(card, rectOf(deck), { duration: 400, spin: -40, scale: 0.6, lift: 14, settle: true });
          await wait(110);
        }
        await wait(300);
        if (dealt.has(me) && mine.length === 2 && !mine.includes('HIDDEN')) for (const [k, card] of dealt.get(me).entries()) await flipCard(card, mine[k], { duration: 340 });
        break;
      }
      case 'act': {
        // A bot thinks for a short beat. The table never waits on the dealer's voice: a call-out
        // he has no time for is simply skipped (see the drop option below).
        if (ev.seat !== me) { seatEls[ev.seat].node.classList.add('is-thinking'); markTurn(ev.seat); await wait(ev.timeout ? 200 : (duel ? 700 : 320) + Math.random() * 280); seatEls[ev.seat].node.classList.remove('is-thinking'); }
        const label = SIZED.has(ev.action) ? `${pk.labels[ev.action]} ${formatCH(ev.bet)}` : pk.labels[ev.action];
        tag(ev.seat, ev.timeout ? `시간 초과 · ${label}` : label, ev.action === 'FOLD' ? 'fold' : SIZED.has(ev.action) ? 'aggr' : '');
        // The bots' table talk knows Hold'em's words; a 7포커 bet size talks like a raise.
        say(ev.seat, SIZED.has(ev.action) && !CHATTER.SHARK[ev.action] ? 'RAISE' : ev.action, ev.action === 'ALL_IN' ? 0.9 : 0.35);
        // The dealer reads only a new size on the table, by its amount alone: "Sixty thousand".
        // A call (the same amount again) goes unsaid. The newest call-out replaces any still
        // waiting, so he never falls behind the table and the table never waits for him.
        if (ev.action === 'ALL_IN') voice.say('all-in', { cut: true });
        else if (ev.action === 'CHECK') voice.say('check', { next: true });
        else if (ev.action === 'BET' || ev.action === 'RAISE') voice.say(betLine(ev.action, ev.bet), { next: true });
        else if (SIZED.has(ev.action)) voice.say(betLine('RAISE', ev.bet), { next: true });
        if (ev.action === 'FOLD') {
          const cards = [...seatEls[ev.seat].cards.children];
          // Folded cards are slid face down into the muck in the middle, not back into the deck.
          await Promise.all(cards.map((c, k) => flyTo(c, rectOf(burn), { duration: 380, delay: k * 50, fade: true })));
          seatEls[ev.seat].cards.replaceChildren();
          seatEls[ev.seat].node.classList.add('is-folded');
          inHand.delete(ev.seat);
          if (inHand.size === 2) enterDuel();
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
        // Burn one: the top card goes face down beside the deck before the street is dealt.
        await burnOne();
        for (const text of ev.cards) {
          const card = createCard(text, { faceUp: false });
          boardEl.append(card);
          sound.card();
          await flyFrom(card, rectOf(deck), { duration: 360, spin: -20, scale: 0.7, lift: 10, settle: true });
        }
        // Heads-up, the turn and the river are squeezed open slowly, with a heartbeat first.
        const slow = duel && ev.cards.length === 1;
        if (slow) { haptic([20, 120, 20]); sound.tick(); await wait(380); sound.tick(); await wait(260); }
        for (const card of [...boardEl.children].filter(c => !c.classList.contains('is-faceup'))) await flipCard(card, card.dataset.card, slow ? { duration: 900, squeeze: true } : { duration: 300 });
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
          // The pot is pushed across the cloth as one pile, not tossed chip by chip.
          return flyFrom(c, { left: from.left + (k % 3 - 1) * 5, top: from.top - (k >> 1) * 2, width: from.width, height: from.height }, { duration: 620, delay: k * 18, easing: 'cubic-bezier(.3,.05,.2,1)' }).then(() => c.remove());
        });
        sound.chips(Math.min(pay.length, 6));
        if (ev.seat === me) { sound.win(); haptic([20, 60, 30]); t.glow(); }
        else say(ev.seat, 'WIN', 0.6);
        await Promise.all(flying);
        setStack(ev.seat, ev.stack);
        tag(ev.seat, ev.uncalled ? '반환' : `+${formatCH(ev.amount)}`, 'win');
        // Everyone else folded: no hand to call, the winner is the last one standing.
        if (!ev.hand && !ev.uncalled && !shown.size && !target.node.querySelector('[data-hand-name]')) {
          lastStanding = true;
          const name = el('span', 'pk-handname pk-handname--last', 'LAST STANDING');
          name.dataset.handName = '';
          target.node.append(name);
        }
        // A full house or better at showdown is a moment.
        if (ev.seat === me && BIG_HANDS.has(ev.hand)) await t.bigWin(ev.amount, { title: ev.hand, subtitle: pk.gameLabel });
        break;
      }
      case 'end': {
        leaveDuel();
        ev.stacks.forEach((s, i) => setStack(i, s));
        const net = handStart === null ? 0 : ev.stacks[me] - handStart;
        const names = [...new Set(winners)].map(i => (i === me ? pk.meName : pk.nameOf(i, current?.seats?.[i] || {})));
        const label = lastStanding ? (net > 0 ? 'Last standing' : `${names.join(', ')} · Last standing`) : net > 0 ? 'You win' : names.length ? `${names.join(', ')} wins` : '';
        if (label || net) t.banner(label, net > 0 ? 'win' : net < 0 ? 'lose' : 'push', net);
        t.keepReplay(net, { label, staked: 0 });
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
  // pk.halted cuts a replay short (getting up from a room mid-animation).
  async function playEvents(events, tb, { snap = true } = {}) {
    pk.animating = true;
    if (tb) current = tb;
    try { for (const ev of events) { if (pk.halted) return; await play(ev, tb); paintMyHand(); } }
    finally { pk.animating = false; }
    if (snap && tb) render(tb);
  }

  // The burn: one card off the top, face down, onto the little pile beside the deck.
  async function burnOne() {
    const card = createCard('HIDDEN', { faceUp: false });
    toss(card);
    burn.append(card);
    sound.card();
    await flyFrom(card, rectOf(deck), { duration: 260, spin: -12, scale: 0.9 });
    await wait(120);
  }

  // End of hand: every card is drawn in to the middle into one squared pile, then the pile goes
  // under the deck.
  async function sweep() {
    const cards = [...boardEl.children, ...burn.children, ...seatEls.flatMap(s => [...s.cards.children])];
    if (cards.length) {
      const mid = rectOf(boardEl), d = rectOf(deck);
      const cx = mid.left + mid.width / 2, cy = mid.top + mid.height / 2;
      sound.gather?.();
      await Promise.all(cards.map((c, k) => {
        const r = c.getBoundingClientRect();
        const gx = cx - (r.left + r.width / 2), gy = cy - (r.top + r.height / 2) - k * 0.5;
        const ex = d.left + d.width / 2 - (r.left + r.width / 2), ey = d.top + d.height / 2 - (r.top + r.height / 2);
        return animate(c, [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${gx}px,${gy}px) rotate(0deg)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${gx}px,${gy}px) rotate(0deg)`, opacity: 1, offset: 0.62 },
          { transform: `translate(${ex}px,${ey}px) rotate(-10deg) scale(.6)`, opacity: 0 }
        ], { duration: 640, delay: k * 22, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'forwards' });
      }));
    }
    boardEl.replaceChildren();
    burn.replaceChildren();
    seatEls.forEach(s => { s.cards.replaceChildren(); s.node.classList.remove('is-winner'); s.node.querySelector('[data-hand-name]')?.remove(); });
    clearTags();
    paintMyHand();
  }

  function clear() {
    seatsEl.replaceChildren(); seatEls.length = 0; pk.layout = null; current = null;
    boardEl.replaceChildren();
    burn.replaceChildren();
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
  // Raise sizes the way a Korean table says them: 따당 (double the bet in front), then 쿼터 / 하프 /
  // 풀 (a quarter, half or all of the pot after calling). Sizes that land on the same amount show once.
  function presetsFor(l) {
    const pot = f => l.currentBet + (l.pot + l.toCall) * f;
    const list = [...(l.toCall > 0 ? [['따당', 2 * l.currentBet]] : []), ['쿼터', pot(0.25)], ['하프', pot(0.5)], ['풀', pot(1)]];
    const seen = new Set([l.maxRaiseTo]);
    const sized = list.map(([label, v]) => [label, clampRaise(l, v)]).filter(([, v]) => !seen.has(v) && seen.add(v));
    return [...sized, ['올인', l.maxRaiseTo]];
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
