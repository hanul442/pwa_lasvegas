// Friends' Hold'em rooms on the solo felt: make a room and share its four-letter code, or
// sit at a friend's. The server owns the table; this screen polls it every 1.5 s while it is
// visible and replays only the events it hasn't played yet, so a friend's raise lands the same
// way a bot's does. Whoever holds the turn gets a ring that runs down their 25 seconds.
import { api, errorMessage } from '../api.js';
import { el, formatCH, flyFrom, flyTo, sound, wait } from '../fx.js';
import { createChip, breakdown, TIERS } from '../chips.js';
import { voice } from '../voice.js';
import { STYLE_LABEL } from './holdem-view.js';

const POLL_MS = 1500;
const LIST_MS = 4000;
const sleep = value => new Promise(resolve => setTimeout(resolve, value)); // real time, not paced by motion settings
const tierName = slug => TIERS[slug]?.name || slug;

export function createFriends(t, pk, bar, hooks) {
  const oval = pk.oval;
  let room = null; // last server view of the room
  let code = null;
  let cursor = null; // { hand, from }: what this screen has played
  let active = false;
  let pollTimer = null, listTimer = null;
  let applying = Promise.resolve();
  let clockKey = '';
  let size = 6;
  let prompted = ''; // the hand and turn "Your action" was last called for

  // ---------- lobby panel ----------
  const panel = el('div', 'pk-lobby');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'pk-lobby-title');
  panel.innerHTML = `
    <header class="pk-lobby-head"><h2 id="pk-lobby-title">친구와 함께</h2><button type="button" class="pk-lobby-close" data-close aria-label="닫기">×</button></header>
    <section class="pk-lobby-block">
      <h3>방 만들기</h3>
      <p class="pk-lobby-note" data-create-note></p>
      <div class="pk-opponents" role="radiogroup" aria-label="자리 수"><span>자리</span>${[3, 4, 5, 6].map(n => `<button type="button" role="radio" data-size="${n}" aria-checked="${n === 6}">${n}</button>`).join('')}</div>
      <button type="button" class="pk-lobby-primary" data-create></button>
    </section>
    <section class="pk-lobby-block">
      <h3><label for="pk-code">코드로 입장</label></h3>
      <form class="pk-code" data-code-form>
        <input id="pk-code" data-code inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="4" placeholder="ABCD">
        <button type="submit" data-code-go>입장</button>
      </form>
    </section>
    <section class="pk-lobby-block">
      <h3>열린 방</h3>
      <ul class="pk-rooms" data-rooms aria-live="polite"></ul>
    </section>`;
  oval.append(panel);
  const createBtn = panel.querySelector('[data-create]'), createNote = panel.querySelector('[data-create-note]');
  const codeInput = panel.querySelector('[data-code]'), list = panel.querySelector('[data-rooms]');
  panel.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
    size = Number(b.dataset.size);
    panel.querySelectorAll('[data-size]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    sound.tick();
  }));
  panel.querySelector('[data-close]').addEventListener('click', () => close());
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  panel.querySelector('[data-code-form]').addEventListener('submit', e => {
    e.preventDefault();
    if (codeInput.value.length !== 4) { t.toast('방 코드 4자리를 넣어 주세요'); codeInput.focus(); return; }
    t.run(() => join(codeInput.value));
  });
  createBtn.addEventListener('click', () => t.run(create));

  function paintCreate() {
    const ready = t.betReady;
    createBtn.disabled = !ready;
    createBtn.textContent = ready ? `방 만들기 · 바이인 ${formatCH(t.total)}` : '방 만들기';
    createNote.textContent = ready ? '방을 만들면 4자리 코드가 나와요. 친구들은 같은 바이인으로 앉아요.' : `아래 칩으로 바이인을 먼저 올려 주세요 (${formatCH(t.tier.min)} 이상).`;
  }

  async function loadList() {
    let res;
    try { res = await api.holdemRooms(); } catch { return; }
    if (panel.hidden) return;
    const rooms = res.rooms || [];
    if (!rooms.length) {
      list.replaceChildren(el('li', 'pk-rooms-empty', '지금 열린 방이 없어요. 방을 만들고 친구에게 코드를 알려 주세요.'));
      return;
    }
    list.replaceChildren(...rooms.map(r => {
      const li = el('li', 'pk-room-row');
      li.innerHTML = `<div><b></b><span></span><small></small></div><button type="button"></button>`;
      li.querySelector('b').textContent = `${r.host}의 방`;
      li.querySelector('span').textContent = r.people.join(', ');
      li.querySelector('small').textContent = `${tierName(r.tier)} · 바이인 ${formatCH(r.buyIn)} · ${r.started ? '게임 중' : '대기 중'} · ${r.code}`;
      const go = li.querySelector('button');
      go.textContent = r.mine ? '돌아가기' : '앉기';
      go.addEventListener('click', () => t.run(() => (r.mine ? rejoin(r.code) : join(r.code))));
      return li;
    }));
  }

  function open() {
    if (active || hooks.soloOpen()) return;
    panel.hidden = false;
    paintCreate();
    loadList();
    clearInterval(listTimer);
    listTimer = setInterval(() => { if (!document.hidden) loadList(); }, LIST_MS);
    panel.querySelector('[data-close]').focus({ preventScroll: true });
  }
  function close() {
    panel.hidden = true;
    clearInterval(listTimer);
    t.body.querySelector('[data-friends-open]')?.focus({ preventScroll: true });
  }

  // ---------- entering and leaving ----------
  const chipEl = el('button', 'pk-roomchip');
  chipEl.type = 'button';
  chipEl.hidden = true;
  oval.append(chipEl);
  chipEl.addEventListener('click', async () => {
    const line = `VEGAS 홀덤 방 코드 ${code} · Hold'em에서 "친구와 함께"를 누르고 코드로 입장해 주세요.`;
    try { await navigator.clipboard.writeText(line); t.toast('초대 문구를 복사했어요'); }
    catch { t.toast(`방 코드 ${code}`); }
  });
  const tableName = t.root.querySelector('.table-name span');
  const tableNameText = tableName.textContent;

  async function create() {
    if (!t.betReady) return;
    let res;
    try { res = await api.holdemRoomCreate(t.total, t.tier.floor, size); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.lock();
    t.setServerState(res.state);
    await enter(res.room, { from: 'zone' });
    t.toast(`방을 만들었어요. 코드 ${res.room.code}`);
  }

  async function join(roomCode) {
    let res;
    try { res = await api.holdemRoomJoin(roomCode); }
    catch (e) { t.toast(errorMessage(e)); if (e.code === 'ROOM_NOT_FOUND') loadList(); return; }
    if (t.total) await t.clearBet();
    t.setServerState(res.state);
    await enter(res.room, { from: 'wallet' });
  }

  async function rejoin(roomCode) {
    let res;
    try { res = await api.holdemRoom(roomCode); } catch (e) { t.toast(errorMessage(e)); return; }
    await enter(res.room);
  }

  // Back to a room this person is still sitting in (reload, came back later).
  async function resume() {
    const res = await api.holdemRooms();
    if (!res.mine) return;
    const view = await api.holdemRoom(res.mine);
    await enter(view.room);
    t.toast('앉아 있던 방으로 돌아왔어요');
  }

  async function enter(view, { from } = {}) {
    close();
    active = true;
    gone = false;
    code = view.code;
    cursor = null;
    pk.setStakes(view.tier);
    pk.me = view.me;
    pk.clear();
    hooks.showSeated(true);
    t.locked = true;
    t.root.classList.add('is-room');
    tableName.textContent = `친구 방 · 블라인드 ${formatCH(pk.bb / 2)}/${formatCH(pk.bb)}`;
    chipEl.innerHTML = `<span>방 코드</span><b>${view.code}</b>`;
    chipEl.setAttribute('aria-label', `방 코드 ${view.code}, 초대 문구 복사`);
    chipEl.hidden = false;
    await applyRoom(view, null, Date.now());
    // The buy-in becomes my stack: chips off the felt when I made the room, out of the wallet when I joined.
    const mine = pk.seatEls[pk.me];
    if (from && mine) {
      const target = pk.rectOf(mine.plate);
      if (from === 'zone') {
        const stack = [...(t.stackOf('buyin')?.children || [])];
        sound.chips(3);
        await Promise.all(stack.map((c, k) => flyTo(c, target, { duration: 420, delay: k * 25, fade: true })));
        t.emptyZone('buyin');
      } else {
        const values = breakdown(view.buyIn, pk.chipSet, 6);
        const wallet = pk.rectOf(t.balanceEl);
        sound.chips(3);
        await Promise.all(values.map((v, k) => {
          const c = createChip(v); c.classList.add('pk-flying'); document.body.append(c);
          c.style.left = `${target.left + target.width / 2}px`; c.style.top = `${target.top + target.height / 2}px`;
          return flyFrom(c, wallet, { duration: 480, delay: k * 50, lift: 40 }).then(() => c.remove());
        }));
      }
    }
    await t.syncBalance();
    hooks.refreshActions();
    schedule(POLL_MS);
  }

  // Leaving clears the room off the felt and hands the screen back to the solo table.
  async function exit(message) {
    stop();
    active = false;
    room = null;
    code = null;
    chipEl.hidden = true;
    t.root.classList.remove('is-room');
    tableName.textContent = tableNameText;
    if (message) t.toast(message);
  }

  async function leave() {
    const wasBust = bustedNow();
    let res;
    try { res = await api.holdemRoomLeave(code); }
    catch (e) { if (e.code !== 'NOT_IN_ROOM' && e.code !== 'ROOM_NOT_FOUND') { t.toast(errorMessage(e)); return; } res = null; }
    await applying;
    if (res) t.setServerState(res.state);
    const result = res?.result;
    await exit();
    if (result) { await hooks.cashOut(result.cashOut, result.netPnl); hooks.refreshActions(); }
    else await standDown(wasBust ? '칩을 모두 잃었어요' : '이미 테이블에서 일어났어요');
  }

  // The table stood me up (out of chips, or away too long): tidy up without a cash-out to show.
  async function standDown(message) {
    try { t.setServerState(await api.state()); } catch {}
    await exit(message);
    t.locked = false;
    t.root.classList.remove('is-playing');
    await pk.sweep();
    pk.clear();
    pk.setStakes(t.tier.slug);
    hooks.showSeated(false);
    t.refreshBet();
    await t.syncBalance();
    hooks.refreshActions();
  }

  // ---------- polling ----------
  function schedule(delay = POLL_MS) {
    clearTimeout(pollTimer);
    if (active) pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
    if (!active || gone) return;
    // Paused while hidden or while I'm sending a move; the move's reply carries the news.
    if (document.hidden || t.busy) return schedule();
    const sent = cursor && { ...cursor };
    let res;
    try { res = await api.holdemRoom(code, sent); }
    catch (e) {
      if (e.code === 'ROOM_NOT_FOUND') { if (bustedNow()) { goneBust(); return; } await standDown('방이 닫혔어요'); return; }
      return schedule(POLL_MS * 2);
    }
    const at = Date.now();
    await enqueue(res.room, sent, at);
    schedule();
  }
  const onVisible = () => { if (active && !document.hidden) schedule(50); };
  document.addEventListener('visibilitychange', onVisible);

  function enqueue(view, sent, at) {
    applying = applying.then(() => applyRoom(view, sent, at)).catch(() => {});
    return applying;
  }

  // Bring the felt up to a room view: replay what's new, or redraw when too far behind.
  async function applyRoom(view, sent, at) {
    if (!active || view.code !== code) return;
    if (!view.seated && room?.seated) {
      if (bustedNow()) { goneBust(); return; } // the felt keeps the hand that broke me until I get up
      await standDown('테이블에서 일어났어요'); return;
    }
    room = view;
    dealAt = view.nextAt ? (at ?? Date.now()) + (view.nextAt - view.serverNow) : null;
    let events = view.events;
    // Another reply already played part of this (a poll and a move crossing on the wire).
    if (events && sent && cursor && (sent.hand !== cursor.hand || sent.from !== cursor.from)) {
      events = sent.hand === cursor.hand && view.cursor.hand === cursor.hand && !view.prevCount ? events.slice(Math.max(0, cursor.from - sent.from)) : null;
    }
    if (view.cursor.hand === cursor?.hand && view.cursor.from < cursor.from) events = []; // an older reply
    const reseat = pk.me !== view.me;
    pk.me = view.me;
    if (!events || !cursor || events.length > 40 || reseat) {
      pk.clock(-1);
      pk.render(view.table);
    } else if (events.length) {
      pk.clock(-1);
      clockKey = '';
      const prev = events.slice(0, view.prevCount), now = events.slice(view.prevCount);
      cursor = view.cursor;
      if (prev.length) await pk.playEvents(prev, null, { snap: false });
      if (now[0]?.t === 'hand') {
        await wait(400);
        await pk.sweep();
        if (pk.layout !== pk.layoutKey(view.table)) pk.buildSeats(view.table);
      }
      hooks.refreshActions();
      await pk.playEvents(now, view.table);
    } else if (pk.layout !== pk.layoutKey(view.table)) pk.render(view.table);
    cursor = view.cursor;
    paintStatus(view, at ?? Date.now());
    hooks.refreshActions();
  }

  function paintStatus(view, at) {
    const tb = view.table;
    const turn = view.turn;
    const key = turn ? `${turn.seat}:${turn.deadline}` : '';
    if (key !== clockKey) {
      clockKey = key;
      if (turn) pk.clock(turn.seat, at + (turn.deadline - view.serverNow), turn.ms);
      else pk.clock(-1);
    }
    pk.markTurn(tb.toAct);
    const people = view.players.length;
    let line = '';
    if (!view.started) line = view.isHost ? `친구에게 코드 ${view.code}를 알려 주세요 · ${people}명 앉음` : `방장이 딜을 시작하길 기다리는 중 · ${people}명 앉음`;
    else if (view.waiting) line = '다음 핸드부터 앉아요';
    pk.hintLine.hidden = !line;
    pk.hintLine.textContent = line;
  }

  // Out of chips once the hand is over: I stay in the chair (the table stands me up at the next deal).
  let gone = false;
  const bustedNow = () => Boolean(room && room.me >= 0 && room.table.handOver && (room.table.seats[room.me]?.stack ?? 1) <= 0);
  function goneBust() { gone = true; clearTimeout(pollTimer); hooks.refreshActions(); }
  // After a hand I may turn my cards up for everyone, folded or not.
  // Only while the server still has this hand on the table: a slow replay can end after the next deal.
  let dealAt = null, showTimer = 0;
  const canShow = () => Boolean(room && !gone && room.me >= 0 && room.table.handOver && room.table.seats[room.me]?.inHand && !pk.wasShown(room.me) && !pk.animating && (!dealAt || Date.now() < dealAt - 500));
  async function showMine() {
    const sent = cursor && { ...cursor };
    let res;
    try { res = await api.holdemRoomShow(code, sent); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    await enqueue(res.room, sent, Date.now());
  }

  // ---------- controls ----------
  const legal = () => (room && room.me >= 0 && !room.table.handOver && room.table.toAct === room.me && !pk.animating ? room.table.legal : null);

  async function act(action, amount) {
    if (!room || pk.animating) return;
    const tb = room.table;
    const sent = cursor && { ...cursor };
    let res;
    try { res = await api.holdemRoomAction(code, tb.handNo, tb.seq, action, amount, sent); }
    catch (e) { t.toast(errorMessage(e)); schedule(50); return; }
    t.setServerState(res.state);
    pk.clock(-1);
    await enqueue(res.room, sent, Date.now());
  }

  async function deal() {
    const sent = cursor && { ...cursor };
    let res;
    try { res = await api.holdemRoomStart(code, sent ?? { hand: 0, from: 0 }); }
    catch (e) { t.toast(errorMessage(e)); return; }
    await enqueue(res.room, sent ?? { hand: 0, from: 0 }, Date.now());
  }

  // Pre-actions: while others act I can queue my answer (check/fold, check, call X), as on a poker app.
  // It is kept only for the street it was picked on, and dropped when a bet makes it mean something else.
  let pre = null;
  function waitingTurn() {
    const tb = room?.table;
    if (!tb || tb.handOver || room.me < 0 || tb.toAct < 0 || tb.toAct === room.me) return null;
    const me = tb.seats[room.me];
    if (!me?.inHand || me.folded || me.allIn) return null;
    const top = Math.max(...tb.seats.map(s => s.bet || 0));
    return { street: `${tb.handNo}:${tb.street}`, toCall: Math.min(top - me.bet, me.stack) };
  }
  let preTimer = 0;
  function preMove(l) {
    const p = pre;
    if (!p || p.street !== `${room.table.handNo}:${room.table.street}`) return null;
    if (l.canCheck) return 'CHECK';
    if (p.kind === 'checkfold') return 'FOLD';
    if (p.kind === 'call' && l.toCall <= p.amount) return 'CALL';
    return null;
  }

  function refreshActions() {
    const { sizer } = bar;
    const me = room?.table.seats[room.me];
    t.betEl.textContent = formatCH(me?.stack ?? 0);
    const l = legal();
    if (l && !pk.animating) {
      const turn = `${room.table.handNo}:${room.table.seq}`;
      const queued = preMove(l);
      t.setActions(bar.actions(l, act));
      clearTimeout(preTimer);
      if (queued) {
        t.hint(queued === 'FOLD' ? '미리 고른 대로 폴드해요' : queued === 'CALL' ? '미리 고른 대로 콜해요' : '미리 고른 대로 체크해요');
        // The table may still be replaying the moves before mine; the next refresh after that tries again.
        preTimer = setTimeout(() => {
          if (!legal() || t.busy || `${room.table.handNo}:${room.table.seq}` !== turn) return;
          pre = null;
          t.run(() => act(queued));
        }, 350);
        return;
      }
      pre = null;
      t.hint('내 차례예요');
      if (prompted !== turn) { prompted = turn; voice.say('your-action', { next: true }); }
      return;
    }
    sizer.hidden = true;
    const tb = room?.table;
    const turnSeat = tb && tb.toAct >= 0 ? tb.seats[tb.toAct] : null;
    t.hint(!room ? '' : turnSeat ? (tb.toAct === room.me ? '내 차례예요' : `${turnSeat.name} 차례`) : room.started ? '다음 핸드를 곧 돌려요' : '');
    const wait = waitingTurn();
    const street = tb && !tb.handOver ? `${tb.handNo}:${tb.street}` : null;
    if (pre && (pre.street !== street || (wait && ((pre.kind === 'check' && wait.toCall > 0) || (pre.kind === 'call' && wait.toCall > pre.amount))))) pre = null;
    const toggle = (kind, label, amount = 0) => ({
      label, pressed: pre?.kind === kind, disabled: pk.animating,
      onClick: () => { pre = pre?.kind === kind ? null : { kind, amount, street: wait.street }; }
    });
    const queue = !wait ? [] : wait.toCall === 0
      ? [toggle('checkfold', '체크/폴드'), toggle('check', '체크')]
      : [toggle('checkfold', '폴드'), toggle('call', `콜 ${formatCH(wait.toCall)}`, wait.toCall)];
    const show = canShow() ? [{ label: '카드 공개', onClick: showMine }] : [];
    clearTimeout(showTimer);
    if (show.length && dealAt) showTimer = setTimeout(() => { if (active) hooks.refreshActions(); }, Math.max(0, dealAt - 500 - Date.now()));
    if (bustedNow()) {
      t.hint('칩을 모두 잃었어요');
      t.setActions([...show, { label: '나가기', key: '↵', primary: true, disabled: pk.animating, onClick: leave }]);
      return;
    }
    t.setActions([
      { label: '나가기', ghost: true, disabled: pk.animating, onClick: leave },
      ...show,
      ...queue,
      ...(room && room.isHost && !room.started ? [{ label: '딜 시작', key: '↵', primary: true, disabled: pk.animating, onClick: deal }] : [])
    ]);
  }

  // Plates: my friends by nickname with a star, bots by name and temperament.
  const baseName = pk.nameOf, baseNote = pk.noteOf;
  pk.nameOf = (i, s) => (active && i === pk.me ? '나' : active ? s.name : baseName(i, s));
  pk.noteOf = (i, s) => {
    if (!active) return baseNote(i, s);
    if (s.kind === 'human') return room?.hostId === s.id ? '방장' : '친구';
    return s.kind === 'bot' ? `AI · ${STYLE_LABEL[s.style] || ''}` : '';
  };

  function stop() {
    clearTimeout(pollTimer);
    clearInterval(listTimer);
    pk.clock(-1);
  }

  return {
    get active() { return active; },
    legal, refreshActions, open, resume, street: () => room?.table.street,
    onBetChange: () => { if (!panel.hidden) paintCreate(); },
    stop: () => { stop(); active = false; document.removeEventListener('visibilitychange', onVisible); }
  };
}
