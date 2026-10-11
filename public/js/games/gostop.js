// 고스톱: three at the blanket, the player and two AI. Same physical cards as 맞고: every play,
// flip, capture and stolen 피 moves one card node, and both AI turns play out with their names.
// "친구와 함께" puts friends in the AI chairs (room-client.js); the server turns the room so I sit in seat 0.
import { api, errorMessage } from '../api.js';
import { createHwatu, flipHwatu, slap, hwatu, isBombCard, monthOf } from '../hwatu.js';
import { animate, flyFrom, wait, sound, haptic, formatCH, el } from '../fx.js';
import { Table } from '../table.js';
import { voice, goLine } from '../voice.js';
import { createRoomClient } from './room-client.js';

const ME = 0, SEATS = [0, 1, 2], OPPS = [1, 2];
const GOAL = 3, DEPOSIT_POINTS = 10;
const GROUPS = [['gwang', '광'], ['yeol', '끗'], ['tti', '띠'], ['pi', '피']];
const groupOf = id => { const c = hwatu(id); return c.kind === 'yeol' ? 'yeol' : c.kind; };
const piValue = ids => ids.reduce((n, id) => { const c = hwatu(id); return n + (c.kind === 'pi' ? (c.double ? 2 : 1) : 0); }, 0);
const byMonth = (a, b) => (isBombCard(a) ? 99 : monthOf(a)) - (isBombCard(b) ? 99 : monthOf(b)) || a.localeCompare(b);

export async function mountGostop(ctx) {
  const t = new Table({ ...ctx, game: 'gostop', title: '고스톱', feltClass: 'felt--hwatu' });
  const caps = (seat, extra = '') => `<div class="mg-caps ${extra}" data-caps="${seat}">${GROUPS.map(([g, label]) => `<div class="mg-cap mg-cap--${g}" data-group="${g}"><span>${label}<b data-count>0</b></span><div class="mg-cap-cards"></div></div>`).join('')}</div>`;
  const opp = seat => `
    <div class="gs-opp" data-seat="${seat}">
      <div class="gs-opp-head"><span class="mg-name" data-name="${seat}">AI</span><span class="mg-score" data-score="${seat}">0<small>점</small></span></div>
      <div class="gs-opp-meta"><div class="gs-opp-hand" data-opp-hand="${seat}" aria-label="AI 패"></div><small data-hand-count="${seat}"></small><small class="gs-go" data-go="${seat}"></small></div>
      ${caps(seat, 'gs-mini')}
    </div>`;
  t.body.innerHTML = `
    <div class="mg gs">
      <div class="gs-opps">${opp(1)}${opp(2)}</div>
      <div class="mg-board" data-board>
        <div class="mg-pile" data-pile aria-label="뒤집을 패 더미"><span class="mg-pile-count" data-pile-count>48</span></div>
        <button type="button" class="zone mg-zone" data-zone="POINT"><strong>점당</strong><small>이긴 점수 × 점당, 진 사람마다</small></button>
        <button type="button" class="pk-friends-open mg-friends" data-friends-open>친구와 함께</button>
      </div>
      ${caps(ME, 'gs-caps-me')}
      <div class="mg-seat mg-seat--me" data-seat="0"><span class="mg-name">나 <small data-go="0"></small></span><span class="mg-score" data-score="0">0<small>점</small></span></div>
      <div class="mg-hand gs-hand" data-hand role="group" aria-label="내 패"></div>
      <div class="callout" data-callout aria-live="polite"></div>
    </div>`;
  const $ = s => t.body.querySelector(s);
  const zone = t.addZone($('[data-zone="POINT"]'));
  const board = $('[data-board]'), pile = $('[data-pile]'), handEl = $('[data-hand]');
  const callout = $('[data-callout]');
  const nodes = new Map();
  let pileBack = null;
  let names = ['나', '은하', '태오'];
  let view = null;      // last authoritative view from the server
  let model = null;     // what the felt currently shows while events play out
  let selected = null;
  let options = null;   // floor cards the player may pick: { kind: 'pick' | 'choose', ids, card }
  t.gs = { get view() { return view; }, get selected() { return selected; }, plays: 0 };

  const room = createRoomClient(t, 'gostop', {
    label: '고스톱', word: '점당',
    soloBusy: () => Boolean(view && view.status === 'PLAYING'),
    begin, apply, snapshot, refreshActions,
    clear: () => clearFelt()
  });
  t.body.querySelector('[data-friends-open]').addEventListener('click', () => { sound.tick(); room.open(); });

  function paintNames() {
    OPPS.forEach(s => { $(`[data-name="${s}"]`).textContent = names[s]; $(`[data-opp-hand="${s}"]`).setAttribute('aria-label', `${names[s]} 패`); });
  }

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
  // rects for cards that are just arriving (from the pile or an AI hand).
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
    for (const seat of SEATS) {
      const root = t.body.querySelector(`[data-caps="${seat}"]`);
      for (const [g] of GROUPS) {
        const ids = m.captured[seat].filter(id => groupOf(id) === g);
        const box = root.querySelector(`[data-group="${g}"]`);
        const cards = box.querySelector('.mg-cap-cards');
        ids.forEach(id => { const n = place(id, cards); n.tabIndex = -1; n.removeAttribute('role'); n.classList.remove('is-match', 'is-selected'); });
        box.querySelector('[data-count]').textContent = g === 'pi' ? piValue(ids) : ids.length;
      }
    }
    for (const [id, n] of nodes) if (!keep.has(id)) { n.remove(); nodes.delete(id); }
    for (const seat of OPPS) {
      const hand = $(`[data-opp-hand="${seat}"]`);
      while (hand.children.length > m.opp[seat]) hand.lastElementChild.remove();
      while (hand.children.length < m.opp[seat]) hand.append(createHwatu(null, { faceUp: false }));
      $(`[data-hand-count="${seat}"]`).textContent = `${m.opp[seat]}장`;
    }
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
    board.querySelectorAll('.mg-slot').forEach(s => s.classList.toggle('has-option', Boolean(s.querySelector('.is-option'))));
  }

  function paintScore(seat, score) {
    const badge = t.body.querySelector(`[data-score="${seat}"]`);
    badge.innerHTML = `${score}<small>점</small>`;
    badge.classList.toggle('is-hot', score >= GOAL);
  }

  function paintTurn(seat) {
    t.body.querySelectorAll('[data-seat]').forEach(s => s.classList.toggle('is-turn', Number(s.dataset.seat) === seat));
  }

  function paintSeats(v) {
    for (const seat of SEATS) {
      const s = v.scores[seat];
      paintScore(seat, s.base);
      t.body.querySelector(`[data-go="${seat}"]`).textContent = [s.go ? `${s.go}고` : '', s.shakes ? `흔들 ×${s.shakes}` : ''].filter(Boolean).join(' · ');
    }
    paintTurn(v.status === 'PLAYING' ? v.actor : -1);
    handEl.classList.toggle('is-waiting', !(v.status === 'PLAYING' && v.actor === ME));
  }

  const toModel = v => ({ hand: [...v.hand], opp: v.seats.map(s => s.hand), floor: [...v.floor], pileCount: v.pileCount, captured: v.captured.map(c => [...c]), ppeok: v.ppeok });

  async function say(text, seat) {
    callout.textContent = seat === ME ? text : `${names[seat]} · ${text}`;
    const go = /^(\d+)고$/.exec(text);
    voice.say(go ? goLine(Number(go[1])) : text === '스톱' ? 'stop' : null);
    callout.className = `callout callout--${seat === ME ? 'me' : `opp gs-callout--${seat}`}`;
    sound.chip();
    haptic(12);
    await animate(callout, [{ opacity: 0, transform: 'translate(-50%,8px) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1.08)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%,-6px) scale(1)' }], { duration: 900, fill: 'none' });
  }

  // ---------- events ----------
  async function playEvents(events) {
    let lastSeat = ME;
    for (const e of events) {
      // A beat before each AI seat starts its turn, so two AI turns read as two players.
      if (e.seat !== undefined && e.seat !== ME && e.seat !== lastSeat && ['play', 'call'].includes(e.type)) { paintTurn(e.seat); await wait(520); }
      if (e.seat !== undefined && ['play', 'call', 'flip'].includes(e.type)) lastSeat = e.seat;
      if (e.type === 'play') {
        const from = new Map();
        if (e.seat === ME) model.hand = model.hand.filter(id => !e.cards.includes(id) && !(e.dummy && isBombCard(id) && id === model.hand.find(isBombCard)));
        else {
          const back = $(`[data-opp-hand="${e.seat}"]`).lastElementChild?.getBoundingClientRect();
          model.opp[e.seat] = Math.max(0, model.opp[e.seat] - Math.max(1, e.cards.length) + (e.bomb ? 2 : 0));
          e.cards.forEach(id => { if (back) from.set(id, back); });
        }
        if (e.bomb && e.seat === ME) model.hand.push(...(view?.hand || []).filter(isBombCard).filter(id => !model.hand.includes(id)));
        model.floor.push(...e.cards);
        if (e.seat === ME) t.gs.plays++;
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
        sound.card();
        await layout(model, { duration: 400 });
      } else if (e.type === 'steal') {
        model.captured[e.from] = model.captured[e.from].filter(id => id !== e.card);
        model.captured[e.seat].push(e.card);
        await layout(model, { duration: 460 });
      } else if (e.type === 'call') {
        if (/고$/.test(e.text)) t.body.querySelector(`[data-go="${e.seat}"]`).textContent = e.text;
        await say(e.text, e.seat);
      } else if (e.type === 'score') {
        paintScore(e.seat, e.score);
      } else if (e.type === 'turn') {
        paintTurn(e.seat);
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
    t.hint('같은 달 석 장: 폭탄이면 넉 장을 다 먹고 두 사람 피를 뺏고 점수 2배');
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
    try { res = await api.gostopAction(view.id, move); }
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
    const res = await api.gostopOpen().catch(() => null);
    if (res?.round) { view = res.round; model = toModel(view); await layout(model); paintSeats(view); }
  }

  async function finish(v, net) {
    const r = v.result;
    const signed = net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : '';
    let label, note;
    if (r.winner === null) {
      label = '나가리';
      note = '아무도 스톱하지 못했어요. 판돈은 그대로예요.';
    } else {
      const lines = r.lines?.map(l => `${l.label} ${l.points}`).join(' · ') || '';
      const shareText = r.shares.map(s => `${names[s.seat]} ${s.points}점${s.multipliers.length ? ` (${s.multipliers.map(x => x.label).join(' ')})` : ''}`).join(', ');
      if (r.winner === ME) {
        label = `승리 ${r.points}점`;
        note = [lines, shareText].filter(Boolean).join(' / ');
      } else {
        const owed = r.shares.filter(s => s.payer === ME).reduce((n, s) => n + s.points, 0);
        label = owed ? `${names[r.winner]} 승 · ${owed}점 냄` : `${names[r.winner]} 승`;
        note = r.gobak === ME ? '고박: 고를 불렀다 져서 두 사람 몫을 혼자 내요.' : r.gobak !== null ? `${names[r.gobak]} 고박: 내 몫까지 ${names[r.gobak]}가 내요.` : `${names[r.winner]} ${r.base}점${r.go ? ` · ${r.go}고` : ''} — ${shareText}`;
      }
    }
    t.toast(note);
    if (r.winner === ME) voice.say('you-win');
    const big = net > 0 && (r.go >= 3 || r.points >= 10)
      ? { title: r.go >= 3 ? `${r.go}고 승리` : `${r.points}점 승리`, subtitle: r.multipliers.concat(...r.shares.map(s => s.multipliers)).map(x => x.label).filter((x, i, a) => a.indexOf(x) === i).join(' · ') || '고스톱' }
      : null;
    await t.settle(net || 0, { label: `${label}${signed}`, big });
    zone.hidden = false;
    await t.syncBalance();
  }

  // ---------- round start ----------
  async function deal() {
    if (!t.betReady) return;
    t.lock();
    let res;
    try { res = await api.gostopStart(t.total, t.tier.floor); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    await begin(res);
  }

  // A fresh hand from the server, dealt the way a 3인 판 is dealt, then whatever followed.
  async function begin(res) {
    if (room.active) { t.resetRound(); t.locked = true; t.root.classList.add('is-playing'); t.placeLocked('POINT', res.round.stake); t.refreshBet(); }
    await t.syncBalance();
    zone.hidden = true;
    nodes.forEach(n => n.remove()); nodes.clear();
    board.querySelectorAll('.mg-slot').forEach(s => s.remove());
    const round = res.round;
    names = round.seats.map((s, i) => (i === ME ? '나' : s.name || `AI ${i}`));
    paintNames();
    const opening = round.opening;
    model = { hand: [], opp: [0, 0, 0], floor: [], pileCount: 48, captured: [[], [], []], ppeok: [] };
    await layout(model);
    const pileRect = () => pile.getBoundingClientRect();
    // 바닥 3 · 각자 4 · 바닥 3 · 각자 3, the way a 3인 판 is dealt.
    const passes = [[opening.floor.slice(0, 3), 'floor'], [opening.hand.slice(0, 4), 'hand'], [4, 1], [4, 2], [opening.floor.slice(3), 'floor'], [opening.hand.slice(4), 'hand'], [3, 1], [3, 2]];
    for (const [ids, where] of passes) {
      if (typeof where === 'number') {
        model.opp[where] += ids; model.pileCount -= ids; sound.card();
        await layout(model, { duration: 300 });
        [...$(`[data-opp-hand="${where}"]`).children].slice(-ids).forEach(n => flyFrom(n, pileRect(), { duration: 300, scale: 2 }));
        await wait(240);
        continue;
      }
      ids.forEach(id => nodeFor(id, { faceUp: false }));
      model[where].push(...ids);
      model.pileCount -= ids.length;
      sound.card();
      await layout(model, { from: new Map(ids.map(id => [id, pileRect()])), duration: 340, flipIn: ids });
    }
    model.pileCount = 21;
    view = round;
    await playEvents(res.events || []);
    model = toModel(view);
    await layout(model, { duration: 200 });
    paintSeats(view);
    if (view.status === 'SETTLED') await finish(view, res.netPnl);
  }

  // ---------- actions ----------
  function refreshActions() {
    if (!view || view.status !== 'PLAYING') {
      t.setActions(room.active ? room.idleActions() : t.idleActions(t.total ? `시작 · 보증금 ${formatCH(t.total * DEPOSIT_POINTS)}` : '시작', deal));
      return;
    }
    if (view.phase === 'GO_STOP' && view.actor === ME) {
      t.hint(`${view.pending.score}점! 고 하면 +1점, 스톱 하면 지금 점수로 이겨요`);
      t.setActions([
        { label: '스톱', onClick: () => send({ type: 'STOP' }) },
        { label: `${(view.scores[ME].go || 0) + 1}고`, primary: true, onClick: () => send({ type: 'GO' }) }
      ]);
      return;
    }
    if (prompt) { t.setActions(prompt); return; }
    const mine = view.actor === ME;
    t.setActions([
      ...(room.active && !mine ? [room.leaveAction()] : []),
      { label: options ? '취소' : mine ? '낼 패를 고르세요' : `${names[view.actor] || 'AI'} 차례`, ghost: true, disabled: !options, onClick: () => { options = null; selected = null; t.hint(''); refresh(); } },
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
    names = view.seats.map((s, i) => (i === ME ? '나' : s.name || `AI ${i}`));
    paintNames();
    if (room.active) t.locked = true; else t.lock();
    t.root.classList.add('is-playing');
    zone.hidden = true;
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
    names = ['나', '은하', '태오'];
    paintNames();
    model = { hand: [], opp: [0, 0, 0], floor: [], pileCount: 48, captured: [[], [], []], ppeok: [] };
    await layout(model, { duration: 0 });
    SEATS.forEach(s => paintScore(s, 0));
    t.body.querySelectorAll('[data-go]').forEach(n => { n.textContent = ''; });
    paintTurn(-1);
  }

  paintNames();
  // Resume a game left mid-way.
  try {
    const open = await api.gostopOpen();
    if (open.round && (!open.floor || open.floor === t.tier.floor)) {
      await snapshot(open.round);
      t.toast('하던 고스톱 판을 이어서 해요');
    } else if (open.round) t.toast('다른 테이블에 진행 중인 고스톱 판이 있어요');
    else await room.resume();
  } catch {}
  refreshActions();
  const destroy = t.destroy.bind(t);
  t.destroy = () => { room.stop(); return destroy(); };
  return t;
}
