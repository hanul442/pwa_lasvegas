// 7포커 against AI opponents, on the Hold'em felt (holdem-view.js): buy in with chips, ante,
// take three cards and turn one up, then 4th, 5th and 6th street open and the 히든 face down,
// with a round of 체크 · 삥 · 따당 · 쿼터 · 하프 · 콜 · 다이 after each. The server deals and plays
// the bots (lib/sevenpoker-session.mjs); this screen replays its events one by one.
import { api, errorMessage } from '../api.js';
import { wait, formatCH, flyFrom, flyTo, animate, sound, haptic, el } from '../fx.js';
import { createCard, flipCard } from '../cards.js';
import { createChip, breakdown, TIERS } from '../chips.js';
import { Table } from '../table.js';
import { gameName } from '../names.js';
import { voice } from '../voice.js';
import { handCategory, HAND_NAMES } from '../poker-hand.js';
import { createPokerFelt, BLINDS } from './holdem-view.js';

const BET_LABEL = { BBING: '삥', DDADANG: '따당', QUARTER: '쿼터', HALF: '하프' };
const MIN_ANTES = 10; // lib/sevenpoker-session.mjs
const VALUE = { J: 11, Q: 12, K: 13, A: 14 };
const rankOf = c => c.slice(0, -1);

// What a set of face-up cards reads as: "원페어", "트리플"… or "K 하이" when nothing pairs.
function readHand(cards) {
  const cat = handCategory(cards);
  if (cat === null) return '';
  if (cat > 0) return HAND_NAMES[cat];
  const top = cards.map(rankOf).sort((a, b) => (VALUE[b] || Number(b)) - (VALUE[a] || Number(a)))[0];
  return `${top} 하이`;
}

// The ante goes by the buy-in's own stake tier, as the server sets it (lib/sevenpoker-session.mjs):
// the Hold'em small blind of that tier.
const BY_MIN = Object.values(TIERS).sort((a, b) => b.min - a.min);
const anteFor = (total, fallback) => BLINDS[(total > 0 && BY_MIN.find(x => total >= x.min)?.slug) || fallback] / 2;

export async function mountSevenPoker(ctx) {
  const t = new Table({ ...ctx, game: 'sevenpoker', title: gameName('sevenpoker'), feltClass: 'felt--poker felt--sevenpoker' });
  // The Hold'em table's layout (seats round the oval, the action bar) applies here too.
  t.root.classList.add('table-screen--holdem');
  const pk = createPokerFelt(t, { sitdown: `
    <button type="button" class="zone pk-buyin" data-zone="buyin"><strong>Buy-in</strong><small data-antes></small></button>
    <div class="pk-opponents" role="radiogroup" aria-label="상대 수">
      <span>상대</span>${[2, 3, 4].map(n => `<button type="button" role="radio" data-opp="${n}" aria-checked="${n === 3}">${n}</button>`).join('')}
    </div>` });
  pk.labels.FOLD = '다이';
  pk.gameLabel = '7포커';
  let session = null; // last server view
  let busted = null;
  let ante = BLINDS[t.tier.slug] / 2;
  const useAnte = a => { ante = a; pk.chipSet = [ante, ...t.tier.chips.filter(v => v > ante)]; };
  useAnte(ante);
  const antesLabel = t.body.querySelector('[data-antes]');
  const paintAntes = () => {
    if (t.root.classList.contains('is-seated')) return;
    useAnte(anteFor(t.total, t.tier.slug));
    antesLabel.textContent = `앤티 ${formatCH(ante)} · 최소 바이인 ${formatCH(ante * MIN_ANTES)}`;
  };
  paintAntes();
  pk.hintLine.textContent = '칩을 올려 바이인하고 자리에 앉으세요';
  t.addZone(t.body.querySelector('[data-zone="buyin"]'));
  const { seatEls, sitdown, hintLine, rectOf } = pk;
  const deck = t.body.querySelector('[data-deck]');
  const readoutLabel = t.root.querySelector('.bet-readout span');
  let opponents = 3;
  t.body.querySelectorAll('[data-opp]').forEach(b => b.addEventListener('click', () => {
    opponents = Number(b.dataset.opp);
    t.body.querySelectorAll('[data-opp]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    sound.tick();
  }));

  // The bet sizes sit in a row above 다이 / 체크·콜, one tap each, the way Korean poker apps play.
  const bets = el('div', 'pk-sizer sp-bets');
  bets.setAttribute('role', 'group');
  bets.setAttribute('aria-label', '베팅');
  bets.hidden = true;
  t.root.querySelector('.table-controls').prepend(bets);

  let prompted = '';

  // ---------- hand labels ----------
  const faceUp = box => [...box.children].filter(c => c.classList.contains('is-faceup') && !c.classList.contains('is-hole')).map(c => c.dataset.card);
  function pill(i) {
    const e = seatEls[i]; if (!e) return null;
    let node = e.node.querySelector('.sp-showing');
    if (!node) { node = el('span', 'sp-showing'); e.cards.after(node); }
    return node;
  }
  // Under every opponent: what their open cards make. On my plate: what all my cards make.
  pk.paintHands = () => {
    seatEls.forEach((e, i) => {
      if (i === pk.me) {
        const mine = [...e.cards.children].filter(c => c.classList.contains('is-faceup')).map(c => c.dataset.card);
        const node = e.node.querySelector('[data-myhand]');
        const text = mine.length >= 3 ? readHand(mine) : '';
        if (node.textContent !== text) node.textContent = text;
        return;
      }
      const node = pill(i); if (!node) return;
      const open = e.node.classList.contains('is-folded') ? [] : faceUp(e.cards);
      const text = open.length ? readHand(open) : '';
      if (node.textContent !== text) node.textContent = text;
    });
  };
  // My hidden cards (the first two and the 히든) sit a little lower and are marked as only mine.
  function markHoles(tb) {
    const e = seatEls[pk.me], s = tb?.seats?.[pk.me];
    if (!e || !s) return;
    [...e.cards.children].forEach((node, k) => node.classList.toggle('is-hole', !s.up?.[k]));
  }
  function render(tb) {
    pk.render(tb);
    markHoles(tb);
    pk.paintHands();
    if (tb.lead >= 0 && !tb.handOver && tb.phase === 'BET') leadMark(tb.lead);
  }
  function leadMark(i) {
    seatEls.forEach((e, k) => e.node.classList.toggle('is-lead', k === i));
  }

  // ---------- events ----------
  async function dealThree(ev, tb) {
    const mine = tb?.seats?.[pk.me]?.cards || [];
    for (let pass = 0; pass < 3; pass++) for (const i of ev.order) {
      const card = createCard('HIDDEN', { faceUp: false });
      seatEls[i].cards.append(card);
      sound.card();
      flyFrom(card, rectOf(deck), { duration: 360, spin: -40, scale: 0.6, lift: 14 });
      await wait(80);
    }
    await wait(300);
    const box = seatEls[pk.me]?.cards;
    if (box && ev.order.includes(pk.me) && mine.length >= 3 && !mine.slice(0, 3).includes('HIDDEN')) {
      for (const [k, node] of [...box.children].slice(0, 3).entries()) { node.classList.add('is-hole'); await flipCard(node, mine[k], { duration: 300 }); }
    }
  }
  // Everyone's chosen card moves to third place and turns up together.
  async function openCards(ev) {
    sound.tick();
    await Promise.all(ev.cards.map(async ({ seat, card, from }) => {
      const box = seatEls[seat]?.cards; if (!box) return;
      const node = box.children[from] || box.children[2];
      if (!node) return;
      box.append(node);
      node.classList.remove('is-hole');
      if (seat === pk.me) await animate(node, [{ transform: 'translateY(-14px)' }, { transform: 'translateY(0)' }], { duration: 320, fill: 'none' });
      else await flipCard(node, card, { duration: 340 });
    }));
    pk.paintHands();
    await wait(240);
  }
  async function street(ev, tb) {
    leadMark(-1);
    await wait(200);
    for (const { seat, card } of ev.cards) {
      const box = seatEls[seat]?.cards; if (!box) continue;
      const node = createCard('HIDDEN', { faceUp: false });
      box.append(node);
      sound.card();
      haptic(4);
      await flyFrom(node, rectOf(deck), { duration: 320, spin: -24, scale: 0.7, lift: 12 });
      if (card !== 'HIDDEN') flipCard(node, card, { duration: 280 });
      else if (seat === pk.me) {
        // My 히든: only I see it, and it is squeezed open slowly.
        node.classList.add('is-hole');
        const mine = tb?.seats?.[pk.me]?.cards?.[box.children.length - 1];
        if (mine && mine !== 'HIDDEN') await flipCard(node, mine, { duration: 700, squeeze: true });
      }
    }
    await wait(320);
    pk.paintHands();
    if (ev.lead >= 0) leadMark(ev.lead);
  }
  async function playEvents(events, tb, { snap = true } = {}) {
    pk.animating = true;
    refreshActions();
    try {
      for (const ev of events) {
        if (ev.t === 'deal3') await dealThree(ev, tb);
        else if (ev.t === 'open') await openCards(ev);
        else if (ev.t === 'street') await street(ev, tb);
        else if (ev.t === 'turn') pk.markTurn(ev.seat);
        else {
          if (ev.t === 'hand') { leadMark(-1); seatEls.forEach((_, i) => { const p = pill(i); if (p) p.textContent = ''; }); }
          await pk.play(ev, tb);
        }
        pk.paintHands();
      }
    } finally { pk.animating = false; }
    if (snap && tb) render(tb);
  }

  // ---------- server calls ----------
  function apply(res) { t.setServerState(res.state); session = res.session; if (session?.table?.ante) useAnte(session.table.ante); }

  async function resync(message) {
    if (message) t.toast(message);
    try { const open = await api.sevenOpen(); t.setServerState(open.state); session = open.session; } catch { return; }
    if (session) render(session.table);
    showSeated(Boolean(session));
    await t.syncBalance();
  }

  async function sit() {
    if (!t.betReady) return;
    const buyIn = t.total;
    if (buyIn < ante * MIN_ANTES) { t.toast(`바이인은 최소 ${formatCH(ante * MIN_ANTES)}이에요 (앤티 ${formatCH(ante)})`); return; }
    let res;
    try { res = await api.sevenSit(buyIn, t.tier.floor, opponents); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.lock();
    apply(res);
    pk.me = 0;
    pk.buildSeats(res.session.table);
    res.session.table.seats.forEach((_, i) => { seatEls[i].cards.replaceChildren(); pk.paintBet(i, 0); });
    showSeated(true);
    const stackChips = [...t.stackOf('buyin').children];
    sound.chips(3);
    await Promise.all(stackChips.map((c, k) => flyTo(c, rectOf(seatEls[0].plate), { duration: 420, delay: k * 25, fade: true })));
    t.emptyZone('buyin');
    await t.syncBalance();
    seatEls.forEach((s, k) => animate(s.node, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: k * 70, fill: 'backwards' }));
    await wait(350);
    await playEvents(res.events, res.session.table);
    afterEvents();
  }

  async function act(action, index) {
    if (!session || pk.animating) return;
    const tb = session.table;
    let res;
    try { res = await api.sevenAction(session.id, tb.handNo, tb.seq, action, index); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    await playEvents(res.events, res.session.table, { snap: res.session.status !== 'SETTLED' });
    afterEvents();
  }

  async function next() {
    if (!session || pk.animating) return;
    let res;
    try { res = await api.sevenNext(session.id, session.table.handNo); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    await pk.sweep();
    seatEls.forEach((_, i) => { const p = pill(i); if (p) p.textContent = ''; });
    await playEvents(res.events, res.session.table);
    afterEvents();
  }

  async function leave() {
    if (!session) return;
    let res;
    try { res = await api.sevenLeave(session.id); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    if (res.events.length) await playEvents(res.events, session.table, { snap: false });
    await cashOut(session.cashOut ?? 0, session.netPnl ?? 0);
    session = null;
    refreshActions();
  }

  async function cashOut(cash, net) {
    const hero = seatEls[pk.me];
    if (cash > 0 && hero) {
      const values = breakdown(cash, pk.chipSet, 8);
      const from = rectOf(hero.plate);
      sound.chips(4);
      await Promise.all(values.map((v, k) => {
        const c = createChip(v); c.classList.add('pk-flying'); document.body.append(c);
        const r = rectOf(t.balanceEl); c.style.left = `${r.left + r.width / 2}px`; c.style.top = `${r.top + r.height / 2}px`;
        return flyFrom(c, from, { duration: 520, delay: k * 50, lift: 50 }).then(() => c.remove());
      }));
    }
    t.banner(cash > 0 ? '일어났어요' : '칩을 모두 잃었어요', net > 0 ? 'win' : net < 0 ? 'lose' : 'push', net);
    t.locked = false;
    t.root.classList.remove('is-playing');
    await pk.sweep();
    pk.clear();
    pk.setStakes(t.tier.slug);
    leadMark(-1);
    showSeated(false);
    paintAntes();
    t.refreshBet();
    await t.syncBalance();
  }

  function afterEvents() {
    if (session?.status === 'SETTLED') {
      const s = session;
      session = null;
      if (!(s.cashOut > 0)) { busted = s; return refreshActions(); }
      return cashOut(s.cashOut ?? 0, s.netPnl ?? 0).then(refreshActions);
    }
    refreshActions();
  }
  async function getUp() {
    const s = busted; busted = null;
    await cashOut(0, s.netPnl ?? 0);
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

  const legal = () => (session && session.status === 'SEATED' && !session.table.handOver ? session.table.legal : null);
  // While choosing, my three cards are the buttons: tap the one to turn up.
  t.body.addEventListener('click', e => {
    const l = legal();
    if (!l || l.phase !== 'CHOOSE' || pk.animating || t.busy) return;
    const node = e.target.closest('.pk-seat--hero .pk-cards .card');
    if (!node) return;
    const index = [...node.parentNode.children].indexOf(node);
    if (index >= 0 && index < 3) { sound.tick(); t.run(() => act('OPEN', index)); }
  });

  function paintBets(l) {
    const raises = l ? l.options.filter(o => BET_LABEL[o.action]) : [];
    bets.hidden = !raises.length;
    bets.style.setProperty('--n', raises.length);
    bets.innerHTML = `<div class="pk-presets">${raises.map(o => `<button type="button" data-bet="${o.action}"><b>${BET_LABEL[o.action]}${o.allIn ? ' 올인' : ''}</b><small>${formatCH(o.to)}</small></button>`).join('')}</div>`;
    bets.querySelector('.pk-presets').style.setProperty('--n', raises.length);
  }
  bets.addEventListener('click', e => {
    const b = e.target.closest('[data-bet]');
    if (!b || pk.animating || t.busy) return;
    sound.tick();
    t.run(() => act(b.dataset.bet));
  });

  function refreshActions() {
    const hero = seatEls[pk.me]?.cards;
    hero?.classList.remove('is-picking');
    if (busted) {
      paintBets(null);
      t.hint('칩을 모두 잃었어요');
      const again = t.lastBet && t.available >= t.tier.min;
      t.setActions([
        { label: '나가기', key: again ? undefined : '↵', ghost: again, primary: !again, disabled: pk.animating, onClick: getUp },
        ...(again ? [{ label: '같은 바이인으로 다시 앉기', key: '↵', primary: true, disabled: pk.animating, onClick: async () => { await getUp(); await t.rebet(); if (t.betReady) await sit(); } }] : [])]);
      return;
    }
    if (!session) {
      paintBets(null);
      const acts = t.idleActions('앉기', sit, { againLabel: '같은 바이인으로 다시 앉기' });
      const min = ante * MIN_ANTES;
      const go = acts.find(a => a.primary);
      if (t.total > 0 && t.total < min && go) { go.disabled = true; go.label = `앉기 · 최소 ${formatCH(min)}`; }
      t.setActions(acts);
      return;
    }
    const tb = session.table;
    t.betEl.textContent = formatCH(tb.seats[0].stack);
    const l = legal();
    if (l && !pk.animating) {
      const turn = `${tb.handNo}:${tb.seq}`;
      if (l.phase === 'CHOOSE') {
        paintBets(null);
        hero?.classList.add('is-picking');
        t.hint('오픈할 카드 한 장을 눌러 주세요');
        const mine = tb.seats[0].cards;
        t.setActions(mine.slice(0, 3).map((c, k) => ({ label: `${c} 오픈`, key: String(k + 1), onClick: () => act('OPEN', k) })));
        if (prompted !== turn) { prompted = turn; voice.say('your-action', { next: true }); }
        return;
      }
      t.hint('');
      paintBets(l);
      pk.markTurn(0);
      const call = l.options.find(o => o.action === 'CALL');
      t.setActions([
        { label: '다이', key: 'D', ghost: true, onClick: () => act('FOLD') },
        l.canCheck ? { label: '체크', key: 'C', primary: true, onClick: () => act('CHECK') } : { label: `콜 ${formatCH(call.cost)}${call.allIn ? ' 올인' : ''}`, key: 'C', primary: true, onClick: () => act('CALL') }
      ]);
      if (prompted !== turn) { prompted = turn; voice.say('your-action', { next: true }); }
      return;
    }
    paintBets(null);
    const over = tb.handOver;
    t.hint(!over && tb.phase === 'CHOOSE' ? '다른 사람들이 카드를 고르고 있어요' : '');
    t.setActions([
      { label: '일어나기', ghost: true, disabled: pk.animating, onClick: leave },
      { label: '다음 핸드', key: '↵', primary: true, disabled: pk.animating || !over, onClick: next }
    ]);
  }
  t.refreshActions = refreshActions;
  t.onBetChange = () => { paintAntes(); refreshActions(); };

  // D 다이, C 체크·콜, 1–3 the card to open (or the bet sizes), Enter for the primary button.
  t.onKey(e => {
    if (t.busy || pk.animating) return;
    const k = e.key.toLowerCase();
    const l = legal();
    if (l) {
      if (l.phase === 'BET' && /^[1-4]$/.test(k)) {
        const b = bets.querySelectorAll('[data-bet]')[Number(k) - 1];
        if (b) { e.preventDefault(); t.run(() => act(b.dataset.bet)); }
        return;
      }
      const a = t.actionList.find(x => x.key && x.key.toLowerCase() === k);
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
    const open = await api.sevenOpen();
    t.setServerState(open.state);
    if (open.session) {
      session = open.session;
      useAnte(session.table.ante);
      showSeated(true);
      render(session.table);
      t.toast('앉아 있던 테이블로 돌아왔어요');
    }
    await t.syncBalance();
  } catch {}
  refreshActions();
  // Walking away cashes the stack out, a hand in progress given up first (as at the Hold'em table).
  const destroy = t.destroy.bind(t);
  t.destroy = () => {
    const openId = session && session.status === 'SEATED' ? session.id : null;
    destroy();
    if (!openId) return null;
    session = null;
    return api.sevenLeave(openId).catch(() => null);
  };
  return t;
}
