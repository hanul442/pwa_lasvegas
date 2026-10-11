// Texas Hold'em against AI opponents: buy in with chips, cards pitched round the table,
// bets pushed out and raked into the pot, the pot pushed to the winner. The server deals
// and plays the bots; this screen replays its events one by one so every move is visible.
import { api, errorMessage } from '../api.js';
import { createCard, flipCard, setCardFace } from '../cards.js';
import { el, wait, formatCH, flyFrom, flyTo, animate, sound, haptic } from '../fx.js';
import { createChip, breakdown } from '../chips.js';
import { Table } from '../table.js';
import { voice, handLine } from '../voice.js';

const STYLE_LABEL = { ROCK: '타이트', SHARK: '공격형', STATION: '콜링', MANIAC: '루즈' };
const ACT_LABEL = { FOLD: '폴드', CHECK: '체크', CALL: '콜', BET: '벳', RAISE: '레이즈', ALL_IN: '올인', SB: 'SB', BB: 'BB' };
const BLINDS = { low: 5_000, mid: 50_000, high: 500_000, vip: 2_500_000 };

// Seats sit on an ellipse; the person is always at the bottom.
function seatPoint(k, n) {
  const a = (90 + (k * 360) / n) * Math.PI / 180;
  return { x: 50 + 44 * Math.cos(a), y: 50 + 43 * Math.sin(a) };
}

export async function mountHoldem(ctx) {
  const t = new Table({ ...ctx, game: 'holdem', title: "Hold'em", feltClass: 'felt--poker' });
  const bb = BLINDS[t.tier.slug] || BLINDS.low;
  const chipSet = [bb, ...t.tier.chips.filter(v => v > bb)];
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
        <div class="pk-sitdown" data-sitdown>
          <button type="button" class="zone pk-buyin" data-zone="buyin"><strong>Buy-in</strong><small>블라인드 ${formatCH(bb / 2)} / ${formatCH(bb)}</small></button>
          <div class="pk-opponents" role="radiogroup" aria-label="상대 수">
            <span>상대</span>${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-opp="${n}" aria-checked="${n === 5}">${n}</button>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  t.addZone(t.body.querySelector('[data-zone="buyin"]'));
  const $ = s => t.body.querySelector(s);
  const seatsEl = $('[data-seats]'), boardEl = $('[data-board]'), deck = $('[data-deck]');
  const potEl = $('[data-pot]'), potStack = $('[data-pot-stack]'), potAmount = $('[data-pot-amount]');
  const hintLine = $('[data-hint-line]'), sitdown = $('[data-sitdown]'), dealerBtn = $('[data-dealer-button]');
  const readoutLabel = t.root.querySelector('.bet-readout span');
  let opponents = 5;
  t.body.querySelectorAll('[data-opp]').forEach(b => b.addEventListener('click', () => {
    opponents = Number(b.dataset.opp);
    t.body.querySelectorAll('[data-opp]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    sound.tick();
  }));

  // Raise sizer lives in the control bar while seated.
  const sizer = el('div', 'pk-sizer');
  sizer.innerHTML = `
    <div class="pk-presets" role="group" aria-label="레이즈 크기">
      <button type="button" data-preset="0.5">½ 팟</button><button type="button" data-preset="0.75">¾ 팟</button>
      <button type="button" data-preset="1">팟</button><button type="button" data-preset="all">올인</button>
    </div>
    <div class="pk-slider"><button type="button" data-step="-1" aria-label="줄이기">−</button><input type="range" data-range aria-label="레이즈 금액"><button type="button" data-step="1" aria-label="늘리기">+</button></div>`;
  t.root.querySelector('.table-controls').prepend(sizer);
  const range = sizer.querySelector('[data-range]');

  let session = null; // last server view
  let raiseTo = 0;
  let animating = false;
  let prompted = ''; // the hand and turn "Your action" was last called for
  let calledHand = false; // the winning hand is called once, even when side pots pay out again
  const shown = new Map(); // seat -> cards turned up at showdown
  let potLeft = 0; // what is still in the middle while pots are being pushed out

  // ---------- seats ----------
  const seatEls = [];
  function buildSeats(view) {
    const n = view.table.seats.length;
    seatsEl.replaceChildren();
    seatEls.length = 0;
    view.table.seats.forEach((s, i) => {
      const p = seatPoint(i, n);
      const node = el('div', `pk-seat${i === 0 ? ' pk-seat--hero' : ''}`);
      node.dataset.seat = i;
      node.style.setProperty('--x', p.x.toFixed(2));
      node.style.setProperty('--y', p.y.toFixed(2));
      node.innerHTML = `
        <div class="hand pk-cards" data-cards></div>
        <div class="pk-plate"><b data-name></b><span data-stack></span><small data-style></small><em class="pk-tag" data-tag></em></div>`;
      const bet = el('div', 'pk-bet');
      bet.style.setProperty('--x', (50 + (p.x - 50) * 0.55).toFixed(2));
      bet.style.setProperty('--y', (i === 0 ? 88 : 50 + (p.y - 50) * 0.56).toFixed(2));
      bet.innerHTML = '<span class="pk-bet-stack"></span><b></b>';
      seatsEl.append(node, bet);
      seatEls.push({ node, bet, cards: node.querySelector('[data-cards]'), plate: node.querySelector('.pk-plate') });
      paintSeat(i, s);
    });
  }
  function paintSeat(i, s) {
    const e = seatEls[i]; if (!e) return;
    e.node.querySelector('[data-name]').textContent = i === 0 ? '나' : s.name;
    e.node.querySelector('[data-stack]').textContent = formatCH(s.stack);
    e.node.querySelector('[data-style]').textContent = i === 0 ? '' : STYLE_LABEL[s.style] || '';
    e.node.classList.toggle('is-folded', Boolean(s.folded));
    e.node.classList.toggle('is-allin', Boolean(s.allIn));
    e.node.classList.toggle('is-out', s.stack <= 0 && !s.inHand);
  }
  function setStack(i, stack) { const n = seatEls[i]?.node.querySelector('[data-stack]'); if (n) n.textContent = formatCH(stack); }
  function tag(i, text, kind = '') {
    const node = seatEls[i]?.node.querySelector('[data-tag]'); if (!node) return;
    node.textContent = text; node.className = `pk-tag${text ? ' is-shown' : ''}${kind ? ` is-${kind}` : ''}`;
  }
  function clearTags() { seatEls.forEach((_, i) => tag(i, '')); }

  function paintBet(i, amount) {
    const b = seatEls[i]?.bet; if (!b) return null;
    const stack = b.querySelector('.pk-bet-stack');
    b.dataset.amount = amount;
    b.classList.toggle('is-shown', amount > 0);
    b.querySelector('b').textContent = amount ? formatCH(amount) : '';
    const values = amount ? breakdown(amount, chipSet, 6) : [];
    const have = stack.children.length;
    for (let k = have; k < values.length; k++) { const c = createChip(values[k]); c.style.setProperty('--i', k); stack.append(c); }
    while (stack.children.length > values.length) stack.lastElementChild.remove();
    return stack;
  }
  function paintPot(amount) {
    potLeft = amount;
    potEl.hidden = amount <= 0;
    potAmount.textContent = amount ? `POT ${formatCH(amount)}` : '';
    const values = amount ? breakdown(amount, chipSet, 8) : [];
    potStack.replaceChildren(...values.map((v, k) => { const c = createChip(v); c.style.setProperty('--i', k); c.style.setProperty('--jx', `${(k % 3 - 1) * 5}px`); return c; }));
  }
  function moveButton(i) {
    const s = seatEls[i]; if (!s) return;
    const x = Number(s.node.style.getPropertyValue('--x')), y = Number(s.node.style.getPropertyValue('--y'));
    dealerBtn.style.setProperty('--x', (50 + (x - 50) * 0.6 + (x >= 50 ? -6 : 6)).toFixed(2));
    dealerBtn.style.setProperty('--y', (50 + (y - 50) * 0.6 + 4).toFixed(2));
    dealerBtn.classList.add('is-shown');
  }

  // Instantly match the screen to a server view (resume, or to correct any drift).
  function render(view) {
    const tb = view.table;
    if (seatEls.length !== tb.seats.length) buildSeats(view);
    tb.seats.forEach((s, i) => {
      paintSeat(i, s);
      paintBet(i, s.bet);
      const box = seatEls[i].cards;
      const want = s.folded ? [] : s.cards;
      if (box.children.length !== want.length) box.replaceChildren(...want.map(c => createCard(c, { faceUp: c !== 'HIDDEN' })));
      else [...box.children].forEach((node, k) => { if (want[k] !== 'HIDDEN' && node.dataset.card !== want[k]) { setCardFace(node, want[k]); node.classList.add('is-faceup'); } });
    });
    if (boardEl.children.length > tb.board.length) boardEl.replaceChildren();
    for (let k = boardEl.children.length; k < tb.board.length; k++) boardEl.append(createCard(tb.board[k]));
    paintPot(tb.handOver ? 0 : tb.pot - tb.seats.reduce((a, s) => a + s.bet, 0));
    if (tb.handNo) moveButton(tb.button);
    if (tb.toAct >= 0) markTurn(tb.toAct);
  }
  function markTurn(i) { seatEls.forEach((s, k) => s.node.classList.toggle('is-turn', k === i)); }

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

  async function play(ev, view) {
    switch (ev.t) {
      case 'seat': {
        const e = seatEls[ev.seat];
        paintSeat(ev.seat, { name: ev.name, style: ev.style, stack: ev.stack });
        e.cards.replaceChildren();
        await animate(e.node, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 380, fill: 'none' });
        break;
      }
      case 'hand': {
        clearTags();
        markTurn(-1);
        seatEls.forEach((s, i) => { s.node.classList.remove('is-folded', 'is-allin', 'is-winner'); s.node.classList.toggle('is-out', !ev.seats.includes(i)); paintBet(i, 0); s.node.querySelector('[data-hand-name]')?.remove(); });
        moveButton(ev.button);
        shown.clear(); calledHand = false;
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
        const hero = view.table.seats[0].cards;
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
        if (dealt.has(0)) for (const [k, card] of dealt.get(0).entries()) await flipCard(card, hero[k], { duration: 340 });
        break;
      }
      case 'act': {
        if (ev.seat !== 0) { seatEls[ev.seat].node.classList.add('is-thinking'); markTurn(ev.seat); await wait(420 + Math.random() * 380); seatEls[ev.seat].node.classList.remove('is-thinking'); }
        const label = ev.action === 'CALL' || ev.action === 'BET' || ev.action === 'RAISE' || ev.action === 'ALL_IN' ? `${ACT_LABEL[ev.action]}${ev.action === 'CALL' ? '' : ` ${formatCH(ev.bet)}`}` : ACT_LABEL[ev.action];
        tag(ev.seat, label, ev.action === 'FOLD' ? 'fold' : ev.action === 'ALL_IN' || ev.action === 'RAISE' || ev.action === 'BET' ? 'aggr' : '');
        if (ev.action === 'ALL_IN') voice.say('all-in', { cut: true });
        else if (ev.action === 'RAISE') voice.say('raise');
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
        if (ev.seat !== 0) for (const [k, node] of [...box.children].entries()) await flipCard(node, ev.cards[k], { duration: 320 });
        shown.set(ev.seat, ev.cards);
        const name = el('span', 'pk-handname', ev.hand);
        name.dataset.handName = '';
        seatEls[ev.seat].node.append(name);
        await wait(280);
        break;
      }
      case 'win': {
        const target = seatEls[ev.seat];
        target.node.classList.add('is-winner');
        if (ev.hand && !calledHand) {
          calledHand = true;
          voice.say(handLine(ev.hand, [...(shown.get(ev.seat) || view.table.seats[ev.seat].cards || []), ...view.table.board]));
        }
        const pay = breakdown(ev.amount, chipSet, 8);
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
        if (ev.seat === 0) { sound.win(); haptic([20, 60, 30]); t.glow(); }
        await Promise.all(flying);
        setStack(ev.seat, ev.stack);
        tag(ev.seat, ev.uncalled ? '반환' : `+${formatCH(ev.amount)}`, 'win');
        break;
      }
      case 'end': {
        ev.stacks.forEach((s, i) => setStack(i, s));
        const res = view.table.results;
        const heroWon = res?.won?.[0] || 0;
        const heroIn = (view.table.seats[0].committed || 0);
        const net = heroWon - heroIn;
        if (view.status === 'SEATED' || net) {
          const winners = (res?.winners || []).map(i => (i === 0 ? '나' : view.table.seats[i].name));
          const label = net > 0 ? `You win +${formatCH(net)}` : winners.length ? `${winners.join(', ')} wins` : '';
          if (label) t.banner(label, net > 0 ? 'win' : net < 0 ? 'lose' : 'push');
          if (net > 0) voice.say('you-win');
          if (net < 0) sound.lose();
        }
        await wait(500);
        break;
      }
      default: break;
    }
  }

  async function playEvents(events, view) {
    animating = true;
    refreshActions();
    try { for (const ev of events) await play(ev, view); }
    finally { animating = false; }
    render(view);
  }

  // ---------- server calls ----------
  function apply(res) {
    t.setServerState(res.state);
    session = res.session;
  }

  async function resync(message) {
    if (message) t.toast(message);
    try { const open = await api.holdemOpen(); t.setServerState(open.state); session = open.session; } catch { return; }
    if (session) render(session);
    showSeated(Boolean(session));
    await t.syncBalance();
  }

  async function sit() {
    if (!t.betReady) return;
    const buyIn = t.total;
    let res;
    try { res = await api.holdemSit(buyIn, t.tier.floor, opponents); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.lock();
    // The buy-in leaves the cloth and becomes the person's stack.
    apply(res);
    buildSeats(res.session);
    res.session.table.seats.forEach((_, i) => { seatEls[i].cards.replaceChildren(); paintBet(i, 0); });
    showSeated(true);
    const stackChips = [...t.stackOf('buyin').children];
    sound.chips(3);
    await Promise.all(stackChips.map((c, k) => flyTo(c, rectOf(seatEls[0].plate), { duration: 420, delay: k * 25, fade: true })));
    t.emptyZone('buyin');
    await t.syncBalance();
    seatEls.forEach((s, k) => animate(s.node, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: k * 70, fill: 'backwards' }));
    await wait(350);
    await playEvents(res.events, res.session);
    afterEvents();
  }

  async function act(action, amount) {
    if (!session || animating) return;
    const tb = session.table;
    let res;
    try { res = await api.holdemAction(session.id, tb.handNo, tb.seq, action, amount); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    await playEvents(res.events, res.session);
    afterEvents();
  }

  async function next() {
    if (!session || animating) return;
    let res;
    try { res = await api.holdemNext(session.id, session.table.handNo); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    await sweepTable();
    await playEvents(res.events, res.session);
    afterEvents();
  }

  async function sweepTable() {
    const cards = [...boardEl.children, ...seatEls.flatMap(s => [...s.cards.children])];
    await Promise.all(cards.map((c, k) => flyTo(c, rectOf(deck), { duration: 340, delay: k * 18, fade: true })));
    boardEl.replaceChildren();
    seatEls.forEach(s => { s.cards.replaceChildren(); s.node.classList.remove('is-winner'); s.node.querySelector('[data-hand-name]')?.remove(); });
    clearTags();
  }

  async function leave() {
    if (!session) return;
    let res;
    try { res = await api.holdemLeave(session.id); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    await finishSession(res.events);
  }

  async function finishSession(events = []) {
    if (events.length) await playEvents(events, session);
    const net = session.netPnl ?? 0;
    const cash = session.cashOut ?? 0;
    // Remaining stack goes back to the wallet.
    if (cash > 0) {
      const values = breakdown(cash, chipSet, 8);
      const from = rectOf(seatEls[0].plate);
      sound.chips(4);
      await Promise.all(values.map((v, k) => {
        const c = createChip(v); c.classList.add('pk-flying'); document.body.append(c);
        const r = rectOf(t.balanceEl); c.style.left = `${r.left + r.width / 2}px`; c.style.top = `${r.top + r.height / 2}px`;
        return flyFrom(c, from, { duration: 520, delay: k * 50, lift: 50 }).then(() => c.remove());
      }));
    }
    t.banner(`${cash > 0 ? '일어났어요' : '칩을 모두 잃었어요'}${net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : ''}`, net > 0 ? 'win' : net < 0 ? 'lose' : 'push');
    session = null;
    t.locked = false;
    t.root.classList.remove('is-playing');
    await sweepTable();
    seatsEl.replaceChildren(); seatEls.length = 0;
    paintPot(0);
    dealerBtn.classList.remove('is-shown');
    showSeated(false);
    t.refreshBet();
    await t.syncBalance();
    refreshActions();
  }

  function afterEvents() {
    if (session?.status === 'SETTLED') return finishSession();
    refreshActions();
  }

  // ---------- controls ----------
  function showSeated(on) {
    t.root.classList.toggle('is-seated', on);
    sitdown.hidden = on;
    hintLine.hidden = on;
    readoutLabel.textContent = on ? '내 스택' : '바이인';
    if (on) { t.locked = true; t.root.classList.add('is-playing'); }
  }

  function legal() { return session && session.status === 'SEATED' && !session.table.handOver && session.table.toAct === 0 ? session.table.legal : null; }

  function setRaise(value) {
    const l = legal(); if (!l) return;
    const step = bb / 2;
    raiseTo = Math.max(l.minRaiseTo, Math.min(l.maxRaiseTo, Math.round(value / step) * step));
    if (value >= l.maxRaiseTo) raiseTo = l.maxRaiseTo;
    range.value = raiseTo;
    refreshActions();
  }
  sizer.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const l = legal(); if (!l) return;
    sound.tick();
    if (b.dataset.preset === 'all') return setRaise(l.maxRaiseTo);
    const potAfterCall = l.pot + l.toCall;
    setRaise(l.currentBet + potAfterCall * Number(b.dataset.preset));
  }));
  sizer.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => { sound.tick(); setRaise(raiseTo + Number(b.dataset.step) * bb); }));
  range.addEventListener('input', () => setRaise(Number(range.value)));

  function refreshActions() {
    if (!session) {
      sizer.hidden = true;
      t.setActions(t.idleActions('앉기', sit));
      return;
    }
    const hero = session.table.seats[0];
    t.betEl.textContent = formatCH(hero.stack);
    t.hint('');
    const l = legal();
    if (l && !animating) {
      sizer.hidden = !l.canRaise;
      if (l.canRaise) {
        range.min = l.minRaiseTo; range.max = l.maxRaiseTo; range.step = bb / 2;
        if (raiseTo < l.minRaiseTo || raiseTo > l.maxRaiseTo) raiseTo = l.minRaiseTo;
        range.value = raiseTo;
      }
      const allIn = raiseTo >= l.maxRaiseTo;
      t.setActions([
        { label: '폴드', key: 'F', ghost: !l.canCheck, onClick: () => act('FOLD') },
        l.canCheck ? { label: '체크', key: 'C', onClick: () => act('CHECK') } : { label: `콜 ${formatCH(l.toCall)}`, key: 'C', onClick: () => act('CALL') },
        ...(l.canRaise ? [{ label: allIn ? `올인 ${formatCH(raiseTo)}` : `${l.currentBet ? '레이즈' : '벳'} ${formatCH(raiseTo)}`, key: 'R', primary: true, onClick: () => (allIn ? act('ALL_IN') : act('RAISE', raiseTo)) }] : [])
      ]);
      markTurn(0);
      hintLine.hidden = true;
      const turn = `${session.table.handNo}:${session.table.seq}`;
      if (prompted !== turn) { prompted = turn; voice.say('your-action'); }
      return;
    }
    sizer.hidden = true;
    const over = session.table.handOver;
    t.setActions([
      { label: '일어나기', ghost: true, disabled: animating, onClick: leave },
      { label: '다음 핸드', key: '↵', primary: true, disabled: animating || !over, onClick: next }
    ]);
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  t.onKey(e => {
    if (t.busy || animating) return;
    const k = e.key.toLowerCase();
    if (legal()) {
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

  // Resume a seat left open (reload, network drop) so the locked buy-in is never stranded.
  refreshActions();
  try {
    const open = await api.holdemOpen();
    t.setServerState(open.state);
    if (open.session) {
      session = open.session;
      showSeated(true);
      render(session);
      t.toast('앉아 있던 테이블로 돌아왔어요');
    }
    await t.syncBalance();
  } catch {}
  refreshActions();
  return t;
}

