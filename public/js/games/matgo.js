// 맞고: two-player Go-Stop against the house AI. Cards are real objects on the blanket:
// every play, flip, capture and stolen 피 moves the same card node to its new place.
// "친구와 함께" puts a friend in the AI's chair (room-client.js), seen from my own seat.
import { api, errorMessage } from '../api.js';
import { createHwatu, flipHwatu, slap, hwatu, isBombCard, monthOf } from '../hwatu.js';
import { animate, flyFrom, wait, sound, haptic, formatCH, el, ms } from '../fx.js';
import { Table } from '../table.js';
import { voice, goLine } from '../voice.js';
import { createRoomClient } from './room-client.js';
import { doubleStamp, doubleBadge, doubleActions } from '../double-down.js';

const ME = 0, OPP = 1;
const GROUPS = [['gwang', '광'], ['yeol', '끗'], ['tti', '띠'], ['pi', '피']];
const groupOf = id => { const c = hwatu(id); return c.kind === 'yeol' ? 'yeol' : c.kind; };
const piValue = ids => ids.reduce((n, id) => { const c = hwatu(id); return n + (c.kind === 'pi' ? (c.double ? 2 : 1) : 0); }, 0);
const byMonth = (a, b) => (isBombCard(a) ? 99 : monthOf(a)) - (isBombCard(b) ? 99 : monthOf(b)) || a.localeCompare(b);

export async function mountMatgo(ctx) {
  const t = new Table({ ...ctx, game: 'matgo', title: '맞고', feltClass: 'felt--hwatu' });
  const caps = seat => `<div class="mg-caps" data-caps="${seat}">${GROUPS.map(([g, label]) => `<div class="mg-cap mg-cap--${g}" data-group="${g}"><span>${label}<b data-count>0</b></span><div class="mg-cap-cards"></div></div>`).join('')}</div>`;
  t.body.innerHTML = `
    <div class="mg">
      <div class="mg-seat mg-seat--opp" data-seat="1"><span class="mg-name"><span data-opp-name>하우스 AI</span> <small data-go="1"></small></span><div class="mg-opp-hand" data-opp-hand aria-label="상대 패"></div><span class="mg-score" data-score="1">0<small>점</small></span></div>
      ${caps(OPP)}
      <div class="mg-board" data-board>
        <div class="mg-pile" data-pile aria-label="뒤집을 패 더미"><span class="mg-pile-count" data-pile-count>48</span></div>
        <button type="button" class="zone mg-zone" data-zone="POINT"><strong>점당</strong><small>이긴 점수 × 점당</small></button>
        <button type="button" class="pk-friends-open mg-friends" data-friends-open>친구와 함께</button>
      </div>
      ${caps(ME)}
      <div class="mg-seat mg-seat--me" data-seat="0"><span class="mg-name">나 <small data-go="0"></small></span><span class="mg-score" data-score="0">0<small>점</small></span></div>
      <div class="mg-hand" data-hand role="group" aria-label="내 패"></div>
      <div class="callout" data-callout aria-live="polite"></div>
    </div>`;
  const $ = s => t.body.querySelector(s);
  const zone = t.addZone($('[data-zone="POINT"]'));
  const board = $('[data-board]'), pile = $('[data-pile]'), handEl = $('[data-hand]'), oppHand = $('[data-opp-hand]');
  const dd = doubleBadge(board);
  let carry = 1; // 묻고 더블로 가 on offer after a solo 나가리
  const callout = $('[data-callout]');
  const nodes = new Map();
  let pileBack = null;
  let view = null;      // last authoritative view from the server
  let model = null;     // what the felt currently shows while events play out
  let selected = null;
  let options = null;   // floor cards the player may pick: { kind: 'pick' | 'choose', ids, card }
  t.mg = { get view() { return view; }, get selected() { return selected; }, plays: 0 };
  const oppName = $('[data-opp-name]');
  const paintOpp = v => { oppName.textContent = v?.seats?.[OPP]?.name || '하우스 AI'; };

  const room = createRoomClient(t, 'matgo', {
    label: '맞고', word: '점당',
    soloBusy: () => Boolean(view && view.status === 'PLAYING'),
    begin, apply, snapshot, refreshActions,
    clear: () => clearFelt()
  });
  t.body.querySelector('[data-friends-open]').addEventListener('click', () => { sound.tick(); room.open(); });

  // ---------- layout ----------
  function nodeFor(id, { faceUp = true } = {}) {
    let n = nodes.get(id);
    if (!n) {
      n = createHwatu(id, { faceUp });
      n.dataset.id = id;
      nodes.set(id, n);
      n.addEventListener('click', () => onCard(id));
      n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCard(id); } });
    }
    return n;
  }

  function slotFor(month) {
    let slot = board.querySelector(`[data-month="${month}"]`);
    if (!slot) {
      slot = el('div', 'mg-slot');
      slot.dataset.month = month;
      const after = [...board.querySelectorAll('.mg-slot')].find(s => Number(s.dataset.month) > month);
      board.insertBefore(slot, after || zone);
    }
    return slot;
  }

  // Put every card where `m` says, animating anything that moved (FLIP). `from` gives start
  // rects for cards that are just arriving (from the pile or the opponent's hand).
  async function layout(m, { from = new Map(), duration = 380, flipIn = [] } = {}) {
    const before = new Map([...nodes].map(([id, n]) => [id, n.isConnected ? n.getBoundingClientRect() : null]));
    const keep = new Set();
    const place = (id, parent, faceUp = true) => { const n = nodeFor(id, { faceUp }); keep.add(id); parent.append(n); return n; };

    [...m.hand].sort(byMonth).forEach(id => {
      const n = place(id, handEl);
      n.tabIndex = 0;
      n.setAttribute('role', 'button');
      const c = hwatu(id);
      n.classList.toggle('is-match', Boolean(c) && m.floor.some(f => monthOf(f) === c.month));
      n.classList.toggle('is-selected', id === selected);
    });
    const months = new Set(m.floor.map(monthOf));
    board.querySelectorAll('.mg-slot').forEach(s => { if (!months.has(Number(s.dataset.month))) s.remove(); });
    m.floor.forEach(id => place(id, slotFor(monthOf(id))));
    board.querySelectorAll('.mg-slot').forEach(s => s.classList.toggle('is-ppeok', (m.ppeok || []).includes(Number(s.dataset.month))));
    for (const seat of [ME, OPP]) {
      const root = t.body.querySelector(`[data-caps="${seat}"]`);
      for (const [g] of GROUPS) {
        const ids = m.captured[seat].filter(id => groupOf(id) === g);
        const box = root.querySelector(`[data-group="${g}"]`);
        const cards = box.querySelector('.mg-cap-cards');
        ids.forEach(id => { const n = place(id, cards); n.tabIndex = -1; n.removeAttribute('role'); n.classList.remove('is-match', 'is-selected'); });
        // 국진 read as 쌍피 sits with the 열끗 but counts as two 피 (the score line already says so).
        const gukjin = view?.scores?.[seat]?.gukjinAsPi && m.captured[seat].some(id => hwatu(id).gukjin) ? 2 : 0;
        box.querySelector('[data-count]').textContent = g === 'pi' ? piValue(ids) + gukjin : ids.length;
      }
    }
    for (const [id, n] of nodes) if (!keep.has(id)) { n.remove(); nodes.delete(id); }
    while (oppHand.children.length > m.opp) oppHand.lastElementChild.remove();
    while (oppHand.children.length < m.opp) oppHand.append(createHwatu(null, { faceUp: false }));
    if (!pileBack) { pileBack = createHwatu(null, { faceUp: false }); pile.prepend(pileBack); }
    pileBack.hidden = m.pileCount === 0;
    $('[data-pile-count]').textContent = m.pileCount;
    paintOptions();

    const moves = [];
    for (const [id, n] of nodes) {
      const start = from.get(id) || before.get(id);
      if (!start) continue;
      const end = n.getBoundingClientRect();
      if (Math.abs(start.left - end.left) < 1 && Math.abs(start.top - end.top) < 1) continue;
      moves.push(flyFrom(n, start, { duration, scale: start.width / Math.max(1, end.width), lift: from.has(id) ? 24 : 12 }));
    }
    await Promise.all(moves);
    await Promise.all(flipIn.map(id => nodes.get(id) && flipHwatu(nodes.get(id), id)));
  }

  function paintOptions() {
    nodes.forEach((n, id) => n.classList.toggle('is-option', Boolean(options?.ids.includes(id))));
    // Fan the stack open so both choices are easy to tap.
    board.querySelectorAll('.mg-slot').forEach(s => s.classList.toggle('has-option', Boolean(s.querySelector('.is-option'))));
  }

  function paintSeats(v) {
    for (const seat of [ME, OPP]) {
      const s = v.scores[seat];
      const badge = t.body.querySelector(`[data-score="${seat}"]`);
      badge.innerHTML = `${s.base}<small>점</small>`;
      badge.classList.toggle('is-hot', s.base >= 7);
      t.body.querySelector(`[data-go="${seat}"]`).textContent = [s.go ? `${s.go}고` : '', s.shakes ? `흔들 ×${s.shakes}` : ''].filter(Boolean).join(' · ');
      t.body.querySelector(`[data-seat="${seat}"]`).classList.toggle('is-turn', v.status === 'PLAYING' && v.actor === seat);
    }
    handEl.classList.toggle('is-waiting', !(v.status === 'PLAYING' && v.actor === ME));
  }

  const toModel = v => ({ hand: [...v.hand], opp: v.opponentHand, floor: [...v.floor], pileCount: v.pileCount, captured: v.captured.map(c => [...c]), ppeok: v.ppeok });

  async function say(text, seat) {
    callout.textContent = text;
    // 고 and 스톱 are called in the English the table already uses: "Two go", "Stop".
    const go = /^(\d+)고$/.exec(text);
    voice.say(go ? goLine(Number(go[1])) : text === '스톱' ? 'stop' : null);
    callout.className = `callout callout--${seat === ME ? 'me' : 'opp'}`;
    sound.chip();
    haptic(12);
    await animate(callout, [{ opacity: 0, transform: 'translate(-50%,8px) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1.08)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%,-6px) scale(1)' }], { duration: 900, fill: 'none' });
  }

  // ---------- events ----------
  async function playEvents(events) {
    let lastSeat = ME;
    for (const e of events) {
      if (e.seat === OPP && lastSeat !== OPP && ['play', 'call'].includes(e.type)) await wait(520);
      if (e.seat !== undefined) lastSeat = e.seat;
      if (e.type === 'play') {
        const from = new Map();
        if (e.seat === ME) model.hand = model.hand.filter(id => !e.cards.includes(id) && !(e.dummy && isBombCard(id) && id === model.hand.find(isBombCard)));
        else {
          const back = oppHand.lastElementChild?.getBoundingClientRect();
          model.opp = Math.max(0, model.opp - Math.max(1, e.cards.length) + (e.bomb ? 2 : 0));
          e.cards.forEach(id => { if (back) from.set(id, back); });
        }
        if (e.bomb && e.seat === ME) model.hand.push(...(view?.hand || []).filter(isBombCard).filter(id => !model.hand.includes(id)));
        model.floor.push(...e.cards);
        if (e.seat === ME) t.mg.plays++;
        const fresh = e.cards.filter(id => !nodes.has(id));
        fresh.forEach(id => nodeFor(id, { faceUp: false }));
        await layout(model, { from, duration: 340, flipIn: fresh });
        e.cards.forEach(id => nodes.get(id) && slap(nodes.get(id)));
        await wait(140);
      } else if (e.type === 'flip') {
        model.pileCount = Math.max(0, model.pileCount - 1);
        model.floor.push(e.card);
        nodeFor(e.card, { faceUp: false });
        await layout(model, { from: new Map([[e.card, pile.getBoundingClientRect()]]), duration: 320, flipIn: [e.card] });
        slap(nodes.get(e.card));
        await wait(220);
      } else if (e.type === 'capture') {
        await wait(160);
        model.floor = model.floor.filter(id => !e.cards.includes(id));
        model.captured[e.seat].push(...e.cards);
        sound.gather();
        await layout(model, { duration: 400 });
      } else if (e.type === 'steal') {
        model.captured[e.from] = model.captured[e.from].filter(id => id !== e.card);
        model.captured[e.seat].push(e.card);
        await layout(model, { duration: 460 });
      } else if (e.type === 'call') {
        await say(e.text, e.seat);
      } else if (e.type === 'score') {
        const badge = t.body.querySelector(`[data-score="${e.seat}"]`);
        badge.innerHTML = `${e.score}<small>점</small>`;
        badge.classList.toggle('is-hot', e.score >= 7);
      } else if (e.type === 'turn') {
        t.body.querySelectorAll('[data-seat]').forEach(s => s.classList.toggle('is-turn', Number(s.dataset.seat) === e.seat));
      }
    }
  }

  // ---------- input ----------
  function onCard(id) {
    if (t.busy || !view || view.status !== 'PLAYING' || view.actor !== ME) return;
    if (options?.ids.includes(id)) {
      const move = options.kind === 'choose' ? { type: 'CHOOSE', target: id } : { type: 'PLAY', card: options.card, target: id, shake: options.shake };
      options = null;
      return t.run(() => send(move));
    }
    if (!view.hand.includes(id) || view.phase !== 'PLAY') return;
    if (selected !== id) { selected = id; options = null; sound.tick(); refresh(); return; }
    t.run(() => commit(id));
  }

  async function commit(id, { shake = false, single = false } = {}) {
    if (isBombCard(id)) return send({ type: 'FLIP_ONLY' });
    const m = monthOf(id);
    if (!single && view.legal.bomb.includes(m)) { askBomb(id); return; }
    if (!shake && !single && view.legal.shake.includes(m)) { askShake(id); return; }
    if (view.legal.pick.includes(id)) {
      options = { kind: 'pick', ids: view.floor.filter(f => monthOf(f) === m), card: id, shake };
      paintOptions();
      t.hint('바닥에서 가져올 패를 탭하세요');
      refreshActions();
      return;
    }
    return send({ type: 'PLAY', card: id, shake });
  }

  let prompt = null;
  function askBomb(id) {
    prompt = [
      { label: '한 장만 내기', ghost: true, onClick: () => { prompt = null; return commit(id, { single: true }); } },
      { label: '폭탄', primary: true, onClick: () => { prompt = null; return send({ type: 'BOMB', month: monthOf(id) }); } }
    ];
    t.hint('같은 달 석 장: 폭탄이면 넉 장을 다 먹고 점수 2배');
    refreshActions();
  }
  function askShake(id) {
    prompt = [
      { label: '그냥 내기', ghost: true, onClick: () => { prompt = null; return commit(id, { single: true }); } },
      { label: '흔들기', primary: true, onClick: () => { prompt = null; return commit(id, { shake: true }); } }
    ];
    t.hint('같은 달 석 장을 보여 주면 이길 때 점수 2배');
    refreshActions();
  }

  async function send(move) {
    selected = null;
    options = null;
    prompt = null;
    t.hint('');
    if (room.active) return room.act(move);
    let res;
    try { res = await api.matgoAction(view.id, move); }
    catch (e) { t.toast(errorMessage(e)); await sync(); return; }
    await apply(res);
  }

  async function apply(res) {
    if (res.state) t.setServerState(res.state);
    view = res.round;
    if (res.events?.length) await playEvents(res.events);
    model = toModel(view);
    await layout(model, { duration: 200 });
    paintSeats(view);
    if (view.status === 'SETTLED') await finish(view, res.netPnl);
    else if (view.phase === 'CHOOSE_FLIP' && view.actor === ME) {
      options = { kind: 'choose', ids: view.pending.options };
      paintOptions();
      t.hint('뒤집은 패로 가져올 바닥 패를 탭하세요');
    }
  }

  async function sync() {
    const res = await api.matgoOpen().catch(() => null);
    if (res?.round) { view = res.round; model = toModel(view); await layout(model); paintSeats(view); }
  }

  async function finish(v, net) {
    const r = v.result;
    let label;
    if (r.winner === null) {
      label = `나가리 · 다음 판 ×${r.nextDouble}`;
      if (!room.active) carry = r.nextDouble;
    }
    else {
      const extras = r.multipliers.map(x => x.label).join(' ');
      label = `${r.winner === ME ? '승리' : '패배'} ${r.points}점${extras ? ` (${extras})` : ''}`;
    }
    if (r.winner === ME) voice.say('you-win');
    t.toast(r.winner === null ? (room.active ? `나가리! 다음 판은 묻고 더블 ×${r.nextDouble}로 가요.` : `나가리! 묻고 더블로 가면 다음 판은 ×${r.nextDouble}이에요.`) : r.lines?.map(l => `${l.label} ${l.points}`).join(' · ') || '');
    // Three go's or a ten-point hand stop the table.
    const goes = r.multipliers?.find(x => /고$/.test(x.label) && x.label !== '고박');
    const big = r.winner === ME && (goes || r.points >= 10) ? { title: goes ? goes.label : `${r.points}점`, subtitle: goes ? '고 · 고 · 고' : '큰 판' } : null;
    await t.settle(net || 0, { label: `${label}`, big });
    zone.hidden = false;
    await t.syncBalance();
  }

  // ---------- round start ----------
  async function deal(double = false) {
    if (!t.betReady) return;
    t.lock();
    let res;
    try { res = await api.matgoStart(t.total, t.tier.floor, double === true); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    carry = 1;
    await begin(res);
  }

  // A fresh hand from the server, dealt in two passes like a real dealer, then whatever followed.
  async function begin(res) {
    if (room.active) { t.resetRound(); t.locked = true; t.root.classList.add('is-playing'); t.placeLocked('POINT', res.round.stake); t.refreshBet(); }
    paintOpp(res.round);
    await t.syncBalance();
    zone.hidden = true;
    dd.set(res.round.double || 1);
    if (res.round.double > 1) await doubleStamp(t.body, res.round.double);
    // Clear last game's cards, then deal: floor, me, opponent, in two passes like a real dealer.
    nodes.forEach(n => n.remove()); nodes.clear();
    board.querySelectorAll('.mg-slot').forEach(s => s.remove());
    const round = res.round;
    const firstEvents = res.events || [];
    const opening = round.opening;
    model = { hand: [], opp: 0, floor: [], pileCount: 48, captured: [[], []], ppeok: [] };
    await layout(model);
    const pileRect = () => pile.getBoundingClientRect();
    const passes = [[opening.floor.slice(0, 4), 'floor'], [opening.hand.slice(0, 5), 'hand'], [5, 'opp'], [opening.floor.slice(4), 'floor'], [opening.hand.slice(5), 'hand'], [5, 'opp']];
    for (const [ids, where] of passes) {
      if (where === 'opp') { model.opp += ids; model.pileCount -= ids; sound.card(); await layout(model, { duration: 300 }); [...oppHand.children].slice(-ids).forEach(n => flyFrom(n, pileRect(), { duration: 300, scale: 1.4 })); await wait(260); continue; }
      ids.forEach(id => nodeFor(id, { faceUp: false }));
      model[where].push(...ids);
      model.pileCount -= ids.length;
      sound.card();
      await layout(model, { from: new Map(ids.map(id => [id, pileRect()])), duration: 340, flipIn: ids });
    }
    model.pileCount = 20;
    view = round;
    await playEvents(firstEvents);
    model = toModel(view);
    await layout(model, { duration: 200 });
    paintSeats(view);
    if (view.status === 'SETTLED') await finish(view, res.netPnl);
    else if (view.actor === ME) voice.say('your-turn');
  }

  // ---------- actions ----------
  function refreshActions() {
    if (!view || view.status !== 'PLAYING') {
      t.setActions(room.active ? room.idleActions() : carry > 1 ? doubleActions(t, carry, deal) : t.idleActions(t.total ? `시작 · 보증금 ${formatCH(t.total * 10)}` : '시작', deal, { againLabel: '같은 베팅으로 한 판 더' }));
      return;
    }
    if (view.phase === 'GO_STOP' && view.actor === ME) {
      t.hint(`${view.pending.score}점! 고 하면 +1점, 스톱 하면 지금 점수로 이겨요`);
      t.setActions([
        ...(room.active ? [room.leaveAction()] : []),
        { label: '스톱', onClick: () => send({ type: 'STOP' }) },
        { label: `${(view.scores[ME].go || 0) + 1}고`, primary: true, onClick: () => send({ type: 'GO' }) }
      ]);
      return;
    }
    if (prompt) { t.setActions([...(room.active ? [room.leaveAction()] : []), ...prompt]); return; }
    const mine = view.actor === ME;
    t.setActions([
      ...(room.active ? [room.leaveAction()] : []),
      { label: options ? '취소' : mine ? '낼 패를 고르세요' : `${oppName.textContent} 차례`, ghost: true, disabled: !options, onClick: () => { options = null; selected = null; t.hint(''); refresh(); } },
      { label: '내기', primary: true, disabled: !mine || !selected || Boolean(options), onClick: () => commit(selected) }
    ]);
  }
  function refresh() { if (model) layout(model, { duration: 160 }); refreshActions(); }
  t.refreshActions = refreshActions;
  t.onBetChange = () => { refreshActions(); room.onBetChange(); };

  t.onKey(e => {
    if (t.busy || e.target.closest('button,.hw')) return;
    const a = e.key === 'Enter' && (!view || view.status !== 'PLAYING') && t.enterAction();
    if (a) { e.preventDefault(); t.run(a.onClick); }
  });

  // A hand drawn as it stands: coming back to a solo game, or sitting down at a room mid-hand.
  async function snapshot(v) {
    await clearFelt();
    if (v.status !== 'PLAYING') return;
    view = v;
    paintOpp(view);
    if (room.active) t.locked = true; else t.lock();
    t.root.classList.add('is-playing');
    zone.hidden = true;
    dd.set(view.double || 1);
    t.placeLocked('POINT', view.stake); t.refreshBet();
    model = toModel(view);
    await layout(model);
    paintSeats(view);
    if (view.phase === 'CHOOSE_FLIP' && view.actor === ME) { options = { kind: 'choose', ids: view.pending.options }; paintOptions(); }
  }

  // An empty blanket: no cards anywhere, the bet zone back for the next game.
  async function clearFelt() {
    view = null; selected = null; options = null; prompt = null;
    t.resetRound();
    zone.hidden = false;
    dd.set(1);
    paintOpp(null);
    model = { hand: [], opp: 0, floor: [], pileCount: 48, captured: [[], []], ppeok: [] };
    await layout(model, { duration: 0 });
    paintSeats({ status: 'IDLE', actor: -1, scores: [{ base: 0 }, { base: 0 }] });
  }

  // Resume a game left mid-way.
  try {
    const open = await api.matgoOpen();
    carry = open.double || 1;
    if (open.round && (!open.floor || open.floor === t.tier.floor)) {
      await snapshot(open.round);
      t.toast('하던 맞고 판을 이어서 해요');
    } else if (open.round) t.toast('다른 테이블에 진행 중인 맞고 판이 있어요');
    else await room.resume();
  } catch {}
  refreshActions();
  void ms;
  const destroy = t.destroy.bind(t);
  t.destroy = () => { room.stop(); return destroy(); };
  return t;
}
