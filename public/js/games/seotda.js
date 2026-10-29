// 섯다 at a table of AI players: everyone antes, one card each, a betting round round the table,
// a second card squeezed open, a last round, then the hands still in are turned over one by one.
// Each AI bets from its own cards only; the pot slides to whoever holds the best 족보.
// "친구와 함께" seats friends in the same chairs (room-client.js); the server turns the room so I sit in seat 0.
import { api, errorMessage } from '../api.js';
import { createHwatu, flipHwatu, peekHwatu, slap } from '../hwatu.js';
import { animate, flyFrom, flyTo, flyOut, wait, sound, haptic, formatCH, el } from '../fx.js';
import { breakdown, createChip } from '../chips.js';
import { Table } from '../table.js';
import { voice } from '../voice.js';
import { doubleStamp } from '../double-down.js';
import { createRoomClient } from './room-client.js';
import { createBanter } from '../banter.js';

const ME = 0;
const LABEL = { DIE: '다이', CHECK: '체크', BBING: '삥', DDADANG: '따당', QUARTER: '쿼터', HALF: '하프', CALL: '콜', ALLIN: '올인', REJOIN: '재경기 참여', PASS: '안 들어감' };
const RAISE = new Set(['BBING', 'DDADANG', 'QUARTER', 'HALF', 'ALLIN', 'REJOIN']);
const LINE = { DIE: 'die', CHECK: 'check', HALF: 'half', CALL: 'call' };
const NAMES = ['박사장', '김여사', '타짜 정', '막내']; // the server's roster, for the empty table
const COUNT_KEY = 'vegas.seotda.players';

export async function mountSeotda(ctx) {
  const t = new Table({ ...ctx, game: 'seotda', title: '섯다', feltClass: 'felt--seotda' });
  let players = 4;
  try { players = Math.min(5, Math.max(2, Number(localStorage.getItem(COUNT_KEY)) || 4)); } catch {}
  t.body.innerHTML = `
    <div class="sd">
      <div class="sd-ring" data-ring></div>
      <div class="sd-pot">
        <div class="mg-pile sd-deck" data-deck aria-hidden="true"></div>
        <button type="button" class="zone sd-zone" data-zone="ANTE"><strong>판돈</strong><small>모두 똑같이 걸고 시작</small></button>
        <div class="sd-pot-amount" data-pot></div>
        <div class="sd-count" role="radiogroup" aria-label="상대 수">
          <span>상대</span>${[1, 2, 3, 4].map(n => `<button type="button" role="radio" data-opp="${n}" aria-checked="${n === players - 1}">${n}</button>`).join('')}
        </div>
        <button type="button" class="pk-friends-open" data-friends-open>친구와 함께</button>
      </div>
      <section class="sd-seat sd-seat--me" data-seat="0">
        <span class="sd-hand-name" data-name="0"></span>
        <div class="sd-cards" data-cards="0"></div>
        <div class="sd-meta"><span class="mg-name">나</span><span class="sd-said" data-said="0"></span></div>
      </section>
      <div class="callout" data-callout aria-live="polite"></div>
    </div>`;
  const $ = s => t.body.querySelector(s);
  const ring = $('[data-ring]');
  const zone = t.addZone($('[data-zone="ANTE"]'));
  const deck = $('[data-deck]');
  deck.append(createHwatu(null, { faceUp: false }));
  const seatEl = seat => t.body.querySelector(`[data-seat="${seat}"]`);
  const cardsOf = seat => $(`[data-cards="${seat}"]`);
  const potEl = $('[data-pot]'), callout = $('[data-callout]');
  let view = null, mine = 0; // what I have in the pot while events play out
  // While the bets are still landing on the felt, the buttons wait: `view` already holds the end
  // state, so they would otherwise offer my next move before the others have been seen to act.
  let playing = false, liveTurn = -1;
  const DEALING = -2;
  t.sd = { get view() { return view; } };
  // The AI round the table talk as they bet: a dig on a 하프, a sigh on a 다이, a brag on a 땡.
  const banter = createBanter({
    anchor: s => (s === ME ? null : seatEl(s)),
    who: s => { const p = view?.players?.[s]; return p?.kind === 'ai' ? p.name || 'AI' : null; }
  });
  const allSeats = () => (view?.players || []).map((_, s) => s);

  const room = createRoomClient(t, 'seotda', {
    label: '섯다', word: '판돈', sizes: [2, 3, 4, 5], size: 4,
    soloBusy: () => Boolean(view && view.status === 'PLAYING'),
    begin, apply, snapshot, refreshActions,
    clear: () => clearFelt()
  });
  t.body.querySelector('[data-friends-open]').addEventListener('click', () => { sound.tick(); room.open(); });
  t.onBetChange = () => { refreshActions(); room.onBetChange(); };

  // Opponent seats across the top of the felt, outer ones lower so the row reads as an arc.
  function buildSeats(list) {
    ring.dataset.count = list.length;
    ring.replaceChildren(...list.map((p, i) => {
      const s = el('section', `sd-seat sd-seat--opp${p.kind === 'human' ? ' is-friend' : ''}`);
      s.dataset.seat = i + 1;
      s.innerHTML = `<span class="sd-bubble" data-said="${i + 1}"></span>
        <div class="sd-cards sd-cards--opp" data-cards="${i + 1}"></div>
        <div class="sd-plate"><span class="sd-who"></span><b data-put="${i + 1}"></b></div>
        <span class="sd-hand-name" data-name="${i + 1}"></span>`;
      s.querySelector('.sd-who').textContent = p.name || 'AI';
      return s;
    }));
  }
  const preview = () => buildSeats(NAMES.slice(0, players - 1).map(name => ({ name })));

  t.body.querySelectorAll('[data-opp]').forEach(b => b.addEventListener('click', () => {
    if (t.locked) return;
    players = Number(b.dataset.opp) + 1;
    t.body.querySelectorAll('[data-opp]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    try { localStorage.setItem(COUNT_KEY, String(players)); } catch {}
    sound.tick();
    preview();
  }));

  function potStack() {
    let s = zone.querySelector('.bet-stack--payout');
    if (!s) { s = el('span', 'bet-stack bet-stack--payout'); zone.append(s); }
    return s;
  }

  const potText = (pot, put) => { potEl.innerHTML = `${formatCH(pot)}<small>판 · 내가 건 돈 ${formatCH(put)}</small>`; };
  function paintPot(v) { if (v) potText(v.pot, v.contrib[ME]); else potEl.textContent = ''; }

  function paintSeats(v) {
    v.players.forEach((p, s) => {
      const node = seatEl(s);
      node?.classList.toggle('is-folded', p.folded);
      node?.classList.toggle('is-turn', v.status === 'PLAYING' && v.turn === s && s !== ME);
      const put = $(`[data-put="${s}"]`);
      if (put) put.textContent = formatCH(p.contrib);
    });
  }

  function say(seat, action, cost) {
    const node = $(`[data-said="${seat}"]`);
    if (!node) return;
    node.innerHTML = `<b>${LABEL[action]}</b>${cost ? ` ${formatCH(cost)}` : ''}`;
    voice.say(LINE[action]);
    node.classList.add('is-shown');
    node.classList.toggle('is-raise', RAISE.has(action));
    animate(node, [{ opacity: 0, transform: 'translateY(4px) scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 220, fill: 'none' });
  }
  const hush = () => t.body.querySelectorAll('[data-said]').forEach(n => { n.textContent = ''; n.classList.remove('is-shown', 'is-raise'); });

  async function shout(text) {
    callout.textContent = text;
    callout.className = 'callout callout--opp';
    await animate(callout, [{ opacity: 0, transform: 'translate(-50%,8px) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1.08)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%,-6px) scale(1)' }], { duration: 1100, fill: 'none' });
  }

  async function dealTo(seat, id, { squeeze = false } = {}) {
    const box = cardsOf(seat);
    if (!box) return null;
    const node = createHwatu(id && id !== 'HIDDEN' ? id : null, { faceUp: false });
    box.append(node);
    sound.card(); haptic(6);
    await flyFrom(node, deck.getBoundingClientRect(), { duration: seat === ME ? 440 : 320, spin: -16, scale: 0.7, lift: 26, settle: true });
    if (seat === ME && id && id !== 'HIDDEN') {
      if (squeeze) {
        // The second card waits face down for my thumb (패 들춰보기).
        const was = t.hintEl.textContent;
        t.hint('밀어 올려 확인 · 탭하면 뒤집기');
        await peekHwatu(node, id);
        t.hint(was);
      } else await flipHwatu(node, id);
    }
    return node;
  }

  async function seatChips(seat, cost) {
    if (!cost) return;
    const stack = potStack();
    const from = cardsOf(seat).getBoundingClientRect();
    sound.chips(2);
    for (const v of breakdown(cost, t.tier.chips, 6)) {
      const c = createChip(v);
      c.style.setProperty('--i', stack.children.length);
      c.dataset.from = seat;
      stack.append(c);
      flyFrom(c, from, { duration: 360, lift: 30 });
      await wait(50);
    }
  }

  function setTurn(seat) {
    t.body.querySelectorAll('.sd-seat--opp').forEach(n => n.classList.toggle('is-turn', Number(n.dataset.seat) === seat));
  }

  async function playEvents(events) {
    if (!events.length) return;
    playing = true;
    refreshActions();
    try { await playEach(events); } finally { playing = false; liveTurn = -1; }
  }

  async function playEach(events) {
    for (const e of events) {
      if (e.type === 'turn') { setTurn(e.seat); liveTurn = e.seat; if (e.seat !== ME) refreshActions(); }
      else if (e.type === 'bet') {
        if (e.seat !== ME) await wait(520);
        say(e.seat, e.action, e.cost);
        banter.seotdaBet(e, allSeats());
        if (e.cost) { if (e.seat === ME) await t.addFromTray('ANTE', e.cost); else await seatChips(e.seat, e.cost); }
        else sound.tick();
        const put = $(`[data-put="${e.seat}"]`);
        if (put && e.contrib != null) put.textContent = formatCH(e.contrib);
        if (e.action === 'REJOIN') seatEl(e.seat)?.classList.remove('is-folded');
        if (e.action === 'DIE') {
          seatEl(e.seat)?.classList.add('is-folded');
          cardsOf(e.seat).querySelectorAll('.hw').forEach(n => animate(n, [{ transform: 'none' }, { transform: 'translateY(6px)' }], { duration: 300 }));
        }
        if (e.seat === ME) mine = e.contrib;
        potText(e.pot, mine);
        await wait(160);
      } else if (e.type === 'deal') {
        if (liveTurn !== DEALING) { liveTurn = DEALING; refreshActions(); }
        if (e.street === 2 && !t.body.dataset.street2) { t.body.dataset.street2 = '1'; hush(); }
        await dealTo(e.seat, e.card, { squeeze: e.seat === ME && e.street === 2 });
      } else if (e.type === 'reveal') {
        setTurn(-1);
        hush();
        await reveal(e);
        banter.seotdaReveal(e);
      } else if (e.type === 'redeal') {
        await shout(`${e.name} · 재경기`);
        banter.seotdaRedeal(allSeats());
        await doubleStamp(t.body, '판돈 묻고 다시');
        t.toast(view?.players?.some(p => p.folded) ? '판돈은 그대로 묻고 다시 받아요 · 다이한 사람은 판돈 절반을 내면 들어올 수 있어요' : '판돈은 그대로 묻어 두고, 남은 사람끼리 다시 받아요');
        await clearCards();
        delete t.body.dataset.street2;
        hush();
      }
    }
  }

  // Turn the hands still in over one by one, round the table from the lead, each with its 족보.
  async function reveal(e) {
    await wait(350);
    const n = e.hands.length, from = view?.first ?? 0;
    for (let i = 0; i < n; i++) {
      const s = (from + i) % n;
      if (!e.hands[s]) continue;
      if (s !== ME) {
        const nodes = [...cardsOf(s).querySelectorAll('.hw')];
        // Each hand is turned over and slapped down on the blanket.
        for (let k = 0; k < nodes.length; k++) { await flipHwatu(nodes[k], e.hands[s][k], { squeeze: false }); slap(nodes[k]); }
      }
      const tag = $(`[data-name="${s}"]`);
      tag.textContent = e.names[s];
      animate(tag, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 240, fill: 'none' });
      sound.tick();
      await wait(380);
    }
    if (e.redeal) await wait(500);
  }

  async function clearCards() {
    const nodes = [...t.body.querySelectorAll('[data-cards] .hw')];
    // The dealer draws every hand in to the pot in one pile, then puts it under the deck.
    const to = deck.getBoundingClientRect(), mid = zone.getBoundingClientRect();
    const cx = mid.left + mid.width / 2, cy = mid.top + mid.height / 2;
    if (nodes.length) sound.gather?.();
    await Promise.all(nodes.map((n, i) => {
      const r = n.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      return animate(n, [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${cx - x}px,${cy - y - i * 0.6}px) rotate(0deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${cx - x}px,${cy - y - i * 0.6}px) rotate(0deg)`, opacity: 1, offset: 0.62 },
        { transform: `translate(${to.left + to.width / 2 - x}px,${to.top + to.height / 2 - y}px) rotate(8deg) scale(.8)`, opacity: 0 }
      ], { duration: 620, delay: i * 24, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'forwards' });
    }));
    nodes.forEach(n => n.remove());
    t.body.querySelectorAll('[data-name]').forEach(n => { n.textContent = ''; });
  }

  function paintNames(v) {
    v?.players.forEach((p, s) => {
      const tag = $(`[data-name="${s}"]`);
      if (tag) tag.textContent = s === ME ? v.handName || '' : v.result?.hands?.[s] || '';
    });
    if (!v) t.body.querySelectorAll('[data-name]').forEach(n => { n.textContent = ''; });
  }

  async function apply(res) {
    if (res.state) t.setServerState(res.state);
    view = res.round;
    await playEvents(res.events || []);
    paintPot(view);
    paintSeats(view);
    paintNames(view);
    t.syncBalance();
    if (view.status === 'SETTLED') await finish(view, res.netPnl || 0);
  }

  const nameOf = (v, s) => (s === ME ? '나' : v.players[s].name || 'AI');

  async function finish(v, net) {
    const r = v.result, won = r.winners.includes(ME), folded = v.players[ME].folded;
    const top = r.winners.map(s => r.hands[s]).find(Boolean);
    const label = r.reason === 'FOLD' ? (won ? '모두 다이 · 승리' : `다이 · ${nameOf(v, r.winners[0])} 승리`)
      : r.winners.length > 1 ? (won ? `무승부 · ${top} 나눠 가짐` : `${r.winners.map(s => nameOf(v, s)).join(' · ')} 나눠 가짐`)
      : won ? `승리 · ${r.hands[ME]}` : `${folded ? '다이' : '패배'} · ${nameOf(v, r.winners[0])} ${top || ''}`.trim();
    r.winners.forEach(s => seatEl(s)?.classList.add('is-winner'));
    banter.seotdaResult(r, allSeats());
    if (net > 0) voice.say('you-win');
    t.banner(label, net > 0 ? 'win' : net < 0 ? 'lose' : 'push', net);
    t.keepReplay(net, { label, staked: 0 });
    if (net > 0) { sound.win(); haptic([20, 60, 30]); t.glow(); } else if (net < 0) { sound.lose(); haptic(30); } else sound.push();
    if (net > 0 && /광땡|장땡/.test(r.hands[ME] || '')) await t.bigWin(net, { title: r.hands[ME], subtitle: `섯다 · ${formatCH(r.pot)} 판을 가져왔어요` });
    await wait(900);
    // The pot slides to the winner; a split deals the chips out between the winners in turn.
    const chips = [...(t.stackOf('ANTE')?.children || []), ...potStack().children];
    const dest = s => (s === ME ? t.balanceEl : cardsOf(s)).getBoundingClientRect();
    const spots = r.winners.map(dest);
    sound.chips(3);
    const meIdx = r.winners.indexOf(ME);
    await Promise.all(chips.map((c, i) => (i % spots.length === meIdx
      ? flyOut(c, spots[meIdx], { duration: 520, delay: i * 26, lift: 60, onLand: () => t.catchChips() })
      : flyTo(c, spots[i % spots.length], { duration: 460, delay: i * 22, lift: 40, fade: true }))));
    paintPot(null);
    t.resetRound();
    await t.syncBalance();
    refreshActions();
  }

  async function deal() {
    if (!t.betReady) return;
    t.lock();
    let res;
    try { res = await api.seotdaStart(t.total, t.tier.floor, players); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    await begin(res);
  }

  // A fresh hand from the server: seats, everyone's ante, then the first cards.
  async function begin(res) {
    // Last hand's cards are still on the blanket: draw them in before the new deal.
    if (t.body.querySelector('[data-cards] .hw')) await clearCards();
    view = res.round;
    mine = view.stake;
    if (room.active) { t.resetRound(); t.locked = true; t.root.classList.add('is-playing'); t.placeLocked('ANTE', view.stake); t.refreshBet(); }
    buildSeats(view.players.slice(1));
    cardsOf(ME).replaceChildren();
    seatEl(ME).classList.remove('is-winner', 'is-folded');
    hush(); paintNames(null); delete t.body.dataset.street2;
    // Everyone's ante goes in together.
    banter.hello(allSeats());
    await Promise.all(view.players.map((p, s) => (s === ME ? null : seatChips(s, view.stake))));
    paintPot(view);
    paintSeats({ ...view, players: view.players.map(p => ({ ...p, contrib: view.stake, folded: false })) });
    await playEvents(res.events || []);
    paintPot(view);
    paintSeats(view);
    paintNames(view);
    await t.syncBalance();
    if (view.status === 'SETTLED') await finish(view, res.netPnl || 0);
  }

  let prompted = ''; // the betting turn "Your action" was last called for
  function refreshActions() {
    if (!view || view.status !== 'PLAYING') {
      t.setActions(room.active ? room.idleActions() : t.idleActions('시작', deal, { againLabel: '같은 베팅으로 한 판 더' }));
      return;
    }
    if (playing || view.turn !== ME) {
      const who = playing ? liveTurn : view.turn;
      const asking = view.phase === 'REJOIN' && !playing;
      const waiting = { label: who >= 0 && who !== ME ? `${view.players[who]?.name || '상대'} ${asking ? '재경기 참여 고르는 중' : '차례'}` : who === DEALING ? '패 받는 중' : '베팅 중', ghost: true, disabled: true };
      t.setActions(room.active ? [room.leaveAction(), waiting] : [waiting]);
      return;
    }
    const turn = `${view.id}:${view.street}:${view.pot}`;
    if (prompted !== turn) { prompted = turn; voice.say('your-action'); }
    const opts = view.options;
    const capped = opts.some(o => o.capped) || (view.toCall > 0 && !opts.some(o => RAISE.has(o.action) && o.action !== 'ALLIN') && view.contrib[ME] + view.toCall >= view.cap);
    t.hint(view.phase === 'REJOIN' ? `재경기예요 · 판돈 절반 ${formatCH(opts[0]?.cost || 0)}을 내면 다시 들어가요`
      : capped ? `판돈 상한 · 한 사람 ${formatCH(view.cap)}까지만 걸 수 있어요`
      : view.street === 1 ? '첫 장을 보고 베팅해요' : '마지막 베팅이에요');
    t.setActions([...(room.active ? [room.leaveAction()] : []), ...opts.map(o => ({
      label: `${LABEL[o.action]}${o.cost ? ` <small class="action-amt">${formatCH(o.cost)}</small>` : ''}`,
      ghost: o.action === 'DIE' || o.action === 'PASS',
      primary: o.action === 'CALL' || o.action === 'REJOIN' || (o.action === 'CHECK' && !opts.some(x => x.action === 'CALL')) || (o.action === 'ALLIN' && !opts.some(x => x.action === 'CALL' || x.action === 'CHECK')),
      disabled: o.cost > t.available,
      onClick: () => act(o.action)
    }))]);
  }
  t.refreshActions = refreshActions;

  async function act(action) {
    t.hint('');
    if (room.active) return room.act({ action });
    let res;
    try { res = await api.seotdaAction(view.id, action); }
    catch (e) { t.toast(errorMessage(e)); return; }
    await apply(res);
  }

  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && (!view || view.status !== 'PLAYING') && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });

  // A hand drawn as it stands: coming back to a solo hand, or sitting down at a room mid-hand.
  function snapshot(v) {
    clearFelt();
    if (v.status !== 'PLAYING') return;
    view = v;
    mine = view.contrib[ME];
    if (room.active) { t.locked = true; t.root.classList.add('is-playing'); } else t.lock();
    buildSeats(view.players.slice(1));
    t.placeLocked('ANTE', view.contrib[ME]); t.refreshBet();
    const others = view.contrib.reduce((a, c, s) => a + (s === ME ? 0 : c), 0);
    breakdown(others, t.tier.chips, 12).forEach((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); potStack().append(c); });
    view.players.forEach((p, s) => p.cards.forEach(id => cardsOf(s).append(s === ME ? createHwatu(id) : createHwatu(null, { faceUp: false }))));
    view.players.forEach((p, s) => p.last && p.last.street === view.street && say(s, p.last.action, p.last.cost));
    if (view.street === 2) t.body.dataset.street2 = '1';
    paintPot(view);
    paintSeats(view);
    paintNames(view);
  }

  // Nothing on the felt: no cards, no pot, the empty chairs of the solo table.
  function clearFelt() {
    banter.clear();
    view = null;
    t.resetRound();
    cardsOf(ME).replaceChildren();
    seatEl(ME).classList.remove('is-winner', 'is-folded');
    potStack().replaceChildren();
    hush(); paintNames(null); paintPot(null); delete t.body.dataset.street2;
    preview();
  }


  preview();
  try {
    const open = await api.seotdaOpen();
    if (open.round && (!open.floor || open.floor === t.tier.floor)) {
      snapshot(open.round);
      t.toast('하던 섯다 판을 이어서 해요');
    } else if (open.round) t.toast('다른 테이블에 진행 중인 섯다 판이 있어요');
    else await room.resume();
  } catch {}
  refreshActions();
  const destroy = t.destroy.bind(t);
  t.destroy = () => { room.stop(); return destroy(); };
  return t;
}
