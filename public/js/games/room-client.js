// Friends' rooms for 섯다, 고스톱, 맞고, blackjack and baccarat on the solo felt: make a room and share its four-letter
// code, or sit at a friend's. The server owns the table and turns every view so I sit in seat 0,
// so each game draws a room hand with the same code as a solo one. This screen polls every 1.5 s
// while it is visible and hands the game only the events it hasn't played yet.
// The game passes hooks: begin(res) deals a new hand, apply(res) plays events on the current one,
// snapshot(round) draws a hand as it stands, clear() empties the felt, refreshActions().
import { api, errorMessage } from '../api.js';
import { el, formatCH, sound } from '../fx.js';
import { TIERS } from '../chips.js';
import { seatedElsewhere } from './seat-elsewhere.js';
import { shareInvite, takePendingJoin, takePendingWatch } from '../invite.js';
import { createRoomChat } from '../room-chat.js';

const POLL_MS = 1500;
const LIST_MS = 4000;
const sleep = value => new Promise(resolve => setTimeout(resolve, value));
const tierName = slug => TIERS[slug]?.name || slug;

export function createRoomClient(t, game, hooks) {
  const { label, word, sizes = null } = hooks; // word: what the stake is called (판돈, 점당)
  let size = hooks.size ?? sizes?.at(-1) ?? null;
  const stakeNow = () => hooks.stake?.() ?? t.total; // baccarat: the main bet, not the pair spots
  let room = null, code = null, cursor = null;
  let active = false;
  // 관전 (lib/watch.mjs): the friend whose chair I watch from; nothing at the table is mine to play.
  let watching = null, watchName = '';
  const own = { setActions: t.setActions.bind(t), settle: t.settle.bind(t), bigWin: t.bigWin.bind(t) };
  let pollTimer = null, listTimer = null, clockTimer = null;
  let queue = Promise.resolve();

  // ---------- lobby panel ----------
  const panel = el('div', 'pk-lobby rm-lobby');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', `rm-title-${game}`);
  panel.innerHTML = `
    <header class="pk-lobby-head"><h2 id="rm-title-${game}">친구와 ${label}</h2><button type="button" class="pk-lobby-close" data-close aria-label="닫기">×</button></header>
    <section class="pk-lobby-block">
      <h3>방 만들기</h3>
      <p class="pk-lobby-note" data-create-note></p>
      ${sizes ? `<div class="pk-opponents" role="radiogroup" aria-label="자리 수"><span>자리</span>${sizes.map(n => `<button type="button" role="radio" data-size="${n}" aria-checked="${n === size}">${n}</button>`).join('')}</div>` : ''}
      <button type="button" class="pk-lobby-primary" data-create></button>
    </section>
    <section class="pk-lobby-block">
      <h3><label for="rm-code-${game}">코드로 입장</label></h3>
      <form class="pk-code" data-code-form>
        <input id="rm-code-${game}" data-code inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="4" placeholder="ABCD">
        <button type="submit">입장</button>
      </form>
    </section>
    <section class="pk-lobby-block">
      <h3>열린 방</h3>
      <ul class="pk-rooms" data-rooms aria-live="polite"></ul>
    </section>`;
  t.felt.append(panel);
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
    createBtn.textContent = ready ? `방 만들기 · ${word} ${formatCH(stakeNow())}` : '방 만들기';
    createNote.textContent = ready
      ? `방을 만들면 4자리 코드가 나와요. 친구들은 같은 ${word}로 앉고, 빈자리는 AI가 채워요.`
      : `아래 칩으로 ${word}을 먼저 올려 주세요 (${formatCH(t.tier.min)} 이상).`;
  }

  async function loadList() {
    let res;
    try { res = await api.rooms(game); } catch { return; }
    if (panel.hidden) return;
    const rooms = res.rooms || [];
    if (!rooms.length) {
      list.replaceChildren(el('li', 'pk-rooms-empty', '지금 열린 방이 없어요. 방을 만들고 친구에게 코드를 알려 주세요.'));
      return;
    }
    list.replaceChildren(...rooms.map(r => {
      const li = el('li', 'pk-room-row');
      li.innerHTML = '<div><b></b><span></span><small></small></div><button type="button"></button>';
      li.querySelector('b').textContent = `${r.host}의 방`;
      li.querySelector('span').textContent = `${r.people.join(', ')} · ${r.people.length}/${r.size}`;
      li.querySelector('small').textContent = `${tierName(r.tier)} · ${word} ${formatCH(r.stake)} · ${r.started ? '게임 중' : '대기 중'} · ${r.code}`;
      const go = li.querySelector('button');
      go.textContent = r.mine ? '돌아가기' : '앉기';
      go.addEventListener('click', () => t.run(() => (r.mine ? rejoin(r.code) : join(r.code))));
      return li;
    }));
  }

  function open() {
    if (active || hooks.soloBusy()) return;
    t.felt.scrollTop = 0; // the panel covers the felt from its top; a scrolled felt would cut its head off
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
  }

  // ---------- the bar over the felt: code, what we are waiting on, whose clock is running ----------
  const bar = el('div', 'rm-bar');
  bar.hidden = true;
  bar.innerHTML = '<button type="button" class="pk-roomchip rm-chip"></button><span class="rm-status" aria-live="polite"></span><span class="rm-clock" aria-live="off"></span>';
  t.felt.append(bar);
  const chipEl = bar.querySelector('.rm-chip'), statusEl = bar.querySelector('.rm-status'), clockEl = bar.querySelector('.rm-clock');
  chipEl.addEventListener('click', () => shareInvite({ game, label, code, tier: room?.floor || room?.tier, toast: m => t.toast(m) }));
  const chat = createRoomChat(t, { send: line => api.roomChat(code, line), onView: v => chat.sync(v.chat) });
  bar.insertBefore(chat.button, statusEl);
  const tableName = t.root.querySelector('.table-name span');
  const tableNameText = tableName.textContent;

  // ---------- entering and leaving ----------
  async function create() {
    if (!t.betReady) return;
    let res;
    try { res = await api.roomCreate(game, stakeNow(), t.tier.floor, size); }
    catch (e) { if (!blocked(e, create)) t.toast(errorMessage(e)); return; }
    await t.clearBet();
    t.setServerState(res.state);
    await enter(res.room);
    t.toast(`방을 만들었어요. 코드 ${res.room.code}`);
  }

  async function join(roomCode) {
    let res;
    try { res = await api.roomJoin(roomCode); }
    catch (e) { if (!blocked(e, () => join(roomCode))) t.toast(errorMessage(e)); if (e.code === 'ROOM_NOT_FOUND') loadList(); return; }
    if (t.total) await t.clearBet();
    t.setServerState(res.state);
    await enter(res.room);
  }

  // Still sitting at another room: offer to go back there, or to leave it and try again here.
  const blocked = (e, retry) => seatedElsewhere(t, e, retry, e.where?.game === game ? rejoin : null);

  async function rejoin(roomCode) {
    let res;
    try { res = await api.room(roomCode); } catch (e) { t.toast(errorMessage(e)); return; }
    await enter(res.room);
  }

  // Back to a room this person is still sitting in (reload, came back later).
  async function resume() {
    // 관전 from the friends list.
    const watch = takePendingWatch(game);
    if (watch) { await watchRoom(watch.code, watch.watch); return true; }
    // Opened from a friend's invite link: sit at that room.
    // (Already sitting in it, e.g. the host opening their own link: just go back to it.)
    const invited = takePendingJoin(game);
    const res = await api.rooms(game);
    if (invited && invited.toUpperCase() !== res.mine?.code) { await join(invited); return true; }
    if (res.mine?.game !== game) return false;
    const view = await api.room(res.mine.code);
    await enter(view.room);
    t.toast('앉아 있던 방으로 돌아왔어요');
    return true;
  }

  // Watch a friend's chair: the felt plays exactly as at their seat, with their cards, but the
  // action row only offers 그만 보기 and a win or loss is theirs, not mine.
  async function watchRoom(roomCode, friendId) {
    let res;
    try { res = await api.room(roomCode, null, friendId); } catch (e) { t.toast(errorMessage(e)); return; }
    watching = friendId;
    watchName = res.room.watching?.nickname || '친구';
    t.setActions = () => own.setActions([
      { label: '그만 보기', anytime: true, onClick: stopWatching },
      { label: `${watchName}님 자리 관전 중`, ghost: true, disabled: true }
    ]);
    t.settle = async (net, { label } = {}) => {
      t.banner(`${watchName} ${label || ''}`.trim(), net > 0 ? 'win' : net < 0 ? 'lose' : 'push', net);
      if (net > 0) sound.win(); else if (net < 0) sound.lose();
      await sleep(900);
      t.resetRound();
    };
    t.bigWin = () => Promise.resolve();
    await enter(res.room);
    t.toast(`${watchName}님 자리에서 관전해요. 카드는 ${watchName}님 것만 보여요`);
  }
  function unwatch() {
    if (!watching) return;
    watching = null;
    t.setActions = own.setActions;
    t.settle = own.settle;
    t.bigWin = own.bigWin;
  }
  async function stopWatching() {
    if (!active) return;
    stop();
    active = false;
    await queue;
    await exit('관전을 마쳤어요');
  }

  async function enter(view) {
    close();
    active = true;
    code = view.code;
    cursor = null;
    t.locked = true;
    t.root.classList.add('is-room');
    t.root.classList.toggle('is-watching', Boolean(watching));
    tableName.textContent = watching ? `${watchName}님 관전 · ${word} ${formatCH(view.stake)}` : `${tierName(view.tier)} · 친구 방 · ${word} ${formatCH(view.stake)}`;
    chipEl.hidden = Boolean(watching || view.challenge); // the rail doesn't hand out seats, nor does a 1:1 도전
    chipEl.innerHTML = `<span>초대</span><b>${view.code}</b>`;
    chipEl.setAttribute('aria-label', `방 코드 ${view.code}, 친구에게 초대 링크 보내기`);
    bar.hidden = false;
    chat.show(!watching); // the rail can't talk to the table
    await hooks.clear();
    await applyView(view, null);
    schedule(POLL_MS);
  }

  async function exit(message) {
    stop();
    active = false;
    room = null;
    code = null;
    cursor = null;
    bar.hidden = true;
    chat.show(false);
    unwatch();
    chipEl.hidden = false;
    t.root.classList.remove('is-room', 'is-playing', 'is-watching');
    tableName.textContent = tableNameText;
    t.locked = false;
    await hooks.clear();
    t.resetRound();
    try { t.setServerState(await api.state()); } catch {}
    await t.syncBalance();
    if (message) t.toast(message);
    hooks.refreshActions();
  }

  // Works at any moment, even while the felt is still playing out other seats' moves: polling
  // stops at once, and the felt is cleared after whatever is on screen finishes.
  let leaving = false;
  async function leave() {
    if (watching) return stopWatching();
    if (leaving || !active) return;
    leaving = true;
    const midHand = room?.round?.status === 'PLAYING';
    stop();
    let res = null;
    try { res = await api.roomLeave(code); }
    catch (e) {
      if (e.code !== 'NOT_IN_ROOM' && e.code !== 'ROOM_NOT_FOUND') { leaving = false; t.toast(errorMessage(e)); schedule(); return; }
    }
    active = false;
    await queue;
    leaving = false;
    if (res) t.setServerState(res.state);
    await exit(res?.result?.pending || midHand ? '방에서 나왔어요. 하던 판은 자동으로 마저 치고 정산해요.' : '방에서 나왔어요');
  }

  async function deal() {
    try { await api.roomStart(code, cursor ?? { hand: 0, from: 0 }); }
    catch (e) { t.toast(errorMessage(e)); return; }
    schedule(50);
  }

  // ---------- polling ----------
  function schedule(delay = POLL_MS) {
    clearTimeout(pollTimer);
    if (active) pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
    if (!active) return;
    // Paused while hidden or while I'm sending a move; the move's reply carries the news.
    if (document.hidden || t.busy) return schedule();
    const sent = cursor && { ...cursor };
    let res;
    try { res = await api.room(code, sent, watching); }
    catch (e) {
      if (e.code === 'ROOM_NOT_FOUND') { await exit('방이 닫혔어요'); return; }
      if (watching && /^WATCH_/.test(e.code || '')) { active = false; await exit(e.code === 'WATCH_GONE' ? `${watchName}님이 방에서 나갔어요` : errorMessage(e)); return; }
      return schedule(POLL_MS * 2);
    }
    if (typeof res.available === 'number') t.available = res.available;
    enqueue(res.room, sent);
    await queue;
    schedule();
  }
  const onVisible = () => { if (active && !document.hidden) schedule(50); };
  document.addEventListener('visibilitychange', onVisible);

  // A poll's view plays out with the action row held, like the reply to my own move.
  function enqueue(view, sent) {
    queue = queue.then(async () => {
      while (t.busy) await sleep(60);
      if (!active) return;
      t.busy = true;
      t.actions.querySelectorAll('button:not([data-anytime])').forEach(b => { b.disabled = true; });
      try { await applyView(view, sent); } finally { t.busy = false; hooks.refreshActions(); }
    }).catch(() => {});
    return queue;
  }

  const older = (a, b) => a.hand < b.hand || (a.hand === b.hand && a.from < b.from);

  // Bring the felt up to a room view: play what's new, or redraw when too far behind.
  async function applyView(view, sent) {
    if (!active || view.code !== code) return;
    if (!view.seated && !(watching && view.watching)) { await exit(watching ? `${watchName}님이 방에서 나갔어요` : '테이블에서 일어났어요'); return; }
    if (cursor && older(view.cursor, cursor)) return; // a reply older than what is on the felt
    room = view;
    chat.sync(view.chat);
    let events = view.events;
    // Another reply already played part of this (a poll and a move crossing on the wire).
    if (events && sent && cursor && (sent.hand !== cursor.hand || sent.from !== cursor.from)) {
      events = sent.hand === cursor.hand && view.cursor.hand === cursor.hand && cursor.from >= sent.from ? events.slice(cursor.from - sent.from) : null;
    }
    const res = { round: view.round, events: events || [], netPnl: view.netPnl };
    if (!view.round) await hooks.clear();
    else if (!cursor || events === null || events.length > 80) await hooks.snapshot(view.round);
    else if (view.cursor.hand === cursor.hand) { if (events.length) await hooks.apply(res); }
    else {
      if (view.prev?.events.length) await hooks.apply(view.prev); // the end of the last hand first
      await hooks.begin(res);
    }
    cursor = view.cursor;
    t.locked = true;
    paintStatus();
  }

  // 1:1 도전 (lib/challenge.mjs): waiting for the friend, under way, or the result.
  let duelShown = null;
  function challengeLine(v) {
    const c = v.challenge;
    if (!c) return '';
    const meId = v.players.find(p => p.me)?.userId;
    const other = c.from.id === meId ? c.to : c.from;
    if (!c.accepted && !c.done) return `${other.nickname}님을 기다려요 · ${Math.max(1, Math.ceil((c.expiresAt - v.serverNow) / 60_000))}분 안에 안 오면 취소돼요`;
    if (!c.done) return `1:1 도전 · ${other.nickname}님과 ${c.hands > 1 ? `${Math.min(c.played + 1, c.hands)}/${c.hands}판` : '한 판 승부'}`;
    const mine = c.nets?.[meId] || 0;
    const text = c.winner === meId ? `도전 승리 · ${mine > 0 ? `+${formatCH(mine)}` : ''}` : c.winner ? `도전 패배 · ${other.nickname}님 승` : '도전 무승부';
    if (duelShown !== v.code && !watching) { duelShown = v.code; t.toast(c.forfeit ? `${c.forfeit === meId ? '자리를 떠서' : `${other.nickname}님이 자리를 떠서`} 도전이 끝났어요` : `도전 끝! ${text}`); }
    return `${text} · 나가기를 누르면 정리돼요`;
  }

  function paintStatus() {
    const v = room;
    if (!v) return;
    const people = v.players.length;
    let line = '';
    const rail = (v.watchers || []).filter(w => w.userId !== v.watching?.userId);
    const duel = challengeLine(v);
    if (watching) line = v.waiting || !v.playing ? '다음 판을 기다려요' : '👀 관전 중';
    else if (duel) line = duel;
    else if (!v.started) line = v.isHost ? `초대를 눌러 친구에게 링크를 보내 주세요 · ${people}명` : `방장이 시작하길 기다려요 · ${people}명`;
    else if (v.waiting) line = '다음 판부터 AI 자리에 앉아요';
    else if (v.round?.status === 'SETTLED') line = '다음 판을 곧 돌려요';
    // The players see who is on the rail.
    if (!watching && rail.length) line = `${line ? `${line} · ` : ''}👀 ${rail.length === 1 ? `${rail[0].nickname} 관전 중` : `${rail.length}명 관전 중`}`;
    statusEl.textContent = line;
    clearInterval(clockTimer);
    clockEl.textContent = '';
    clockEl.classList.remove('is-mine', 'is-short');
    const turn = v.turn;
    if (!turn) return;
    const deadline = Date.now() + (turn.deadline - v.serverNow);
    const who = turn.seat === 0 ? (watching ? `${watchName} 차례` : '내 차례') : (v.round?.seats?.[turn.seat]?.name || '상대');
    const paint = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      clockEl.textContent = `${who} · ${left}초`;
      clockEl.classList.toggle('is-mine', turn.seat === 0 && !watching);
      clockEl.classList.toggle('is-short', left <= 5);
      if (!left) clearInterval(clockTimer);
    };
    paint();
    clockTimer = setInterval(paint, 250);
  }

  // ---------- moves ----------
  // Sends my move with the cursor of what this screen has played; the reply plays like a poll.
  async function act(move) {
    if (!room || watching) return;
    const sent = cursor && { ...cursor };
    let res;
    try { res = await api.roomAction(code, room.handNo, room.seq, move, sent); }
    catch (e) { t.toast(errorMessage(e)); schedule(50); return; }
    t.setServerState(res.state);
    if (res.room) await applyView(res.room, sent);
    schedule();
  }

  // The action row between hands, and the 나가기 button while others play.
  const leaveAction = () => ({ label: '나가기', ghost: true, anytime: true, onClick: leave });
  function idleActions() {
    const list = [leaveAction()];
    if (room?.challenge) { list.push({ label: room.challenge.done ? '도전 끝' : '친구를 기다려요', disabled: true }); return list; }
    if (room?.isHost && !room.started) list.push({ label: '시작', key: '↵', primary: true, onClick: deal });
    else list.push({ label: room?.started ? '다음 판 대기 중' : '방장이 시작해요', disabled: true });
    return list;
  }

  function stop() {
    clearTimeout(pollTimer);
    clearInterval(listTimer);
    clearInterval(clockTimer);
  }

  return {
    get active() { return active; },
    get watching() { return Boolean(watching); },
    get view() { return room; },
    open, resume, act, idleActions, leaveAction,
    onBetChange: () => { if (!panel.hidden) paintCreate(); },
    stop: () => { stop(); active = false; chat.destroy(); document.removeEventListener('visibilitychange', onVisible); }
  };
}
