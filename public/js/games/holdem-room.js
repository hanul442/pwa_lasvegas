// Friends' Hold'em rooms on the solo felt: make a room and share its four-letter code, or
// sit at a friend's. The server owns the table; this screen polls it every 1.5 s while it is
// visible and replays only the events it hasn't played yet, so a friend's raise lands the same
// way a bot's does. Whoever holds the turn gets a ring that runs down their 25 seconds.
import { shareInvite, takePendingJoin, takePendingWatch } from '../invite.js';
import { createRoomChat } from '../room-chat.js';
// A room can also be a 토너먼트 (sit & go, lib/holdem-tourney.mjs): the same felt, with a level
// clock over it, eliminations called out, and the event result screen with everyone's places.
import { api, errorMessage } from '../api.js';
import { el, formatCH, flyFrom, flyTo, sound, wait } from '../fx.js';
import { createChip, breakdown, TIERS } from '../chips.js';
import { voice } from '../voice.js';
import { STYLE_LABEL } from './holdem-view.js';
import { seatedElsewhere } from './seat-elsewhere.js';
import { eventResult } from '../event-result.js';

const POLL_MS = 1500;
const LIST_MS = 4000;
const sleep = value => new Promise(resolve => setTimeout(resolve, value)); // real time, not paced by motion settings
const tierName = slug => TIERS[slug]?.name || slug;

// opts.game 'sevenpoker' runs the same rooms for 7포커 (cash only): the 7포커 screen passes a bar
// that paints its own bet buttons, and hooks for its stakes (the ante) and the minimum buy-in.
export function createFriends(t, pk, bar, hooks, { game = 'holdem', label = '홀덤' } = {}) {
  const oval = pk.oval;
  const seven = game === 'sevenpoker';
  let room = null; // last server view of the room
  let code = null;
  let cursor = null; // { hand, from }: what this screen has played
  let active = false;
  let pollTimer = null, listTimer = null;
  let applying = Promise.resolve();
  let clockKey = '';
  let size = 6;
  let mode = 'cash'; // or 'tourney'
  let bots = true; // a tournament's empty chairs get AI at the start
  let prompted = ''; // the hand and turn "Your action" was last called for
  // 관전 (lib/watch.mjs): the friend whose chair I watch from, their cards included; nothing to play.
  let watching = null, watchName = '';

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
      <div class="pk-mode" role="radiogroup" aria-label="게임 방식">
        <button type="button" role="radio" data-mode="cash" aria-checked="true">캐시 게임</button>
        <button type="button" role="radio" data-mode="tourney" aria-checked="false">토너먼트</button>
      </div>
      <p class="pk-lobby-note" data-create-note></p>
      <ul class="pk-tourney-rules" data-tourney-rules hidden>
        <li>모두 같은 칩(100BB)으로 시작해요</li>
        <li>블라인드는 3분마다 올라요 · 리바이 없음</li>
        <li>중간에 일어나면 기권이에요</li>
        <li>상금은 사람들 바이인 합계예요 (AI 몫은 없어요)</li>
        <li>2–3명은 1위 독식 · 4명부터 70%/30%</li>
      </ul>
      <div class="pk-opponents" role="radiogroup" aria-label="자리 수"><span>자리</span>${[2, 3, 4, 5, 6].map(n => `<button type="button" role="radio" data-size="${n}" aria-checked="${n === (seven ? 5 : 6)}"${n === 2 && !seven ? ' hidden' : ''}>${n}</button>`).join('')}</div>
      <label class="pk-toggle" data-bots-row hidden><input type="checkbox" data-bots checked><span><b>AI로 채우기</b><small>시작할 때 빈 자리에 AI가 앉아요. AI는 상금을 받지 않아요</small></span></label>
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
  if (seven) { size = 5; panel.querySelector('.pk-mode').remove(); } // 7포커 rooms are cash tables only
  const createBtn = panel.querySelector('[data-create]'), createNote = panel.querySelector('[data-create-note]');
  const codeInput = panel.querySelector('[data-code]'), list = panel.querySelector('[data-rooms]');
  panel.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
    size = Number(b.dataset.size);
    panel.querySelectorAll('[data-size]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    sound.tick();
  }));
  panel.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    panel.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    // Two seats is a heads-up tournament; a cash room starts at three.
    const two = panel.querySelector('[data-size="2"]');
    two.hidden = mode !== 'tourney';
    if (mode !== 'tourney' && size === 2) panel.querySelector('[data-size="3"]').click();
    sound.tick();
    paintCreate();
  }));
  panel.querySelector('[data-bots]').addEventListener('change', e => { bots = e.currentTarget.checked; sound.tick(); });
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
    const tourney = mode === 'tourney';
    createBtn.disabled = !ready;
    const verb = tourney ? '토너먼트 만들기' : '방 만들기';
    createBtn.textContent = ready ? `${verb} · 바이인 ${formatCH(t.total)}` : verb;
    panel.querySelector('[data-tourney-rules]').hidden = !tourney;
    panel.querySelector('[data-bots-row]').hidden = !tourney;
    createNote.textContent = !ready ? `아래 칩으로 바이인을 먼저 올려 주세요 (${formatCH(t.tier.min)} 이상).`
      : tourney ? '바이인은 끝날 때까지 잠겨 있다가 순위대로 정산돼요. 시작하면 늦은 등록은 막혀요.'
      : seven ? '방을 만들면 4자리 코드가 나와요. 친구들은 같은 바이인으로 앉고, 빈 자리는 AI가 채워요.'
      : '방을 만들면 4자리 코드가 나와요. 친구들은 같은 바이인으로 앉아요.';
  }

  async function loadList() {
    let res;
    try { res = await api.holdemRooms(game); } catch { return; }
    if (panel.hidden) return;
    const rooms = res.rooms || [];
    if (!rooms.length) {
      list.replaceChildren(el('li', 'pk-rooms-empty', '지금 열린 방이 없어요. 방을 만들고 친구에게 코드를 알려 주세요.'));
      return;
    }
    list.replaceChildren(...rooms.map(r => {
      const li = el('li', 'pk-room-row');
      li.innerHTML = `<div><b></b><span></span><small></small></div><button type="button"></button>`;
      const tourney = r.mode === 'tourney';
      li.querySelector('b').textContent = `${r.host}의 ${tourney ? '토너먼트' : '방'}`;
      if (tourney) li.querySelector('b').prepend(el('em', 'pk-badge', '토너먼트'));
      li.querySelector('span').textContent = tourney ? `${r.people.length}/${r.size}명 · ${r.people.join(', ')}` : r.people.join(', ');
      li.querySelector('small').textContent = tourney
        ? `${tierName(r.tier)} · 바이인 ${formatCH(r.buyIn)} · ${r.started ? '진행중' : '대기중'} · ${r.code}`
        : `${tierName(r.tier)} · 바이인 ${formatCH(r.buyIn)} · ${r.started ? '게임 중' : '대기 중'} · ${r.code}`;
      const go = li.querySelector('button');
      go.textContent = r.mine ? '돌아가기' : tourney && !r.joinable ? '마감' : tourney ? '참가' : '앉기';
      go.disabled = !r.mine && tourney && !r.joinable;
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
  chipEl.addEventListener('click', () => shareInvite({ game, label, code, tier: room?.tier, toast: m => t.toast(m) }));
  const chat = createRoomChat(t, { send: line => api.holdemRoomChat(code, line), onView: v => chat.sync(v.chat) });
  chat.button.classList.add('chat-open--corner');
  oval.append(chat.button);
  const tableName = t.root.querySelector('.table-name span');
  const tableNameText = tableName.textContent;
  // The line under the title: the floor normally; the blinds while I'm in a room or tournament,
  // so the title itself stays short enough for a folded phone.
  const tableSub = t.root.querySelector('.table-name > span');
  const tableSubHtml = tableSub?.innerHTML;
  const setRoomName = (title, blinds) => {
    tableName.textContent = title;
    if (tableSub) tableSub.innerHTML = `<i>${seven ? '앤티' : '블라인드'} ${blinds}</i>`;
  };

  async function create() {
    if (!t.betReady) return;
    if (seven) { const min = hooks.minBuyIn(); if (t.total < min) { t.toast(`바이인은 최소 ${formatCH(min)}이에요`); return; } }
    else if (mode !== 'tourney' && t.total < pk.bb * 5) { t.toast(`바이인은 최소 ${formatCH(pk.bb * 5)}이에요 (블라인드 ${formatCH(pk.bb / 2)}/${formatCH(pk.bb)})`); return; }
    let res;
    try { res = await api.holdemRoomCreate(t.total, t.tier.floor, mode === 'tourney' || seven ? size : Math.max(3, size), seven ? 'cash' : mode, bots, game); }
    catch (e) { if (!blocked(e, create)) t.toast(errorMessage(e)); return; }
    t.lock();
    t.setServerState(res.state);
    await enter(res.room, { from: 'zone' });
    t.toast(`${res.room.tourney ? '토너먼트를' : '방을'} 만들었어요. 코드 ${res.room.code}`);
  }

  async function join(roomCode) {
    let res;
    try { res = await api.holdemRoomJoin(roomCode); }
    catch (e) { if (!blocked(e, () => join(roomCode))) t.toast(errorMessage(e)); if (e.code === 'ROOM_NOT_FOUND') loadList(); return; }
    if (t.total) await t.clearBet();
    t.setServerState(res.state);
    await enter(res.room, { from: 'wallet' });
  }

  // Still sitting at another room: offer to go back there, or to leave it and try again here.
  const blocked = (e, retry) => seatedElsewhere(t, e, retry, e.where?.game === game ? rejoin : null);

  async function rejoin(roomCode) {
    let res;
    try { res = await api.holdemRoom(roomCode); } catch (e) { t.toast(errorMessage(e)); return; }
    await enter(res.room);
  }

  // Back to a room this person is still sitting in (reload, came back later).
  async function resume() {
    // 관전 from the friends list.
    const watch = takePendingWatch('holdem');
    if (watch) { await watchRoom(watch.code, watch.watch); return; }
    // Opened from a friend's invite link: sit at that room.
    // (Already sitting in it, e.g. the host opening their own link: just go back to it.)
    const invited = takePendingJoin(game);
    const res = await api.holdemRooms(game);
    if (invited && invited.toUpperCase() !== res.mine) { await join(invited); return; }
    if (!res.mine) return;
    const view = await api.holdemRoom(res.mine);
    await enter(view.room);
    t.toast('앉아 있던 방으로 돌아왔어요');
  }

  async function watchRoom(roomCode, friendId) {
    let res;
    try { res = await api.holdemRoom(roomCode, null, friendId); } catch (e) { t.toast(errorMessage(e)); return; }
    watching = friendId;
    watchName = res.room.watching?.nickname || '친구';
    await enter(res.room);
    t.toast(`${watchName}님 자리에서 관전해요. 카드는 ${watchName}님 것만 보여요`);
  }
  async function stopWatching(message = '관전을 마쳤어요') {
    if (!active) return;
    stop();
    active = false;
    pk.halted = true;
    await applying;
    pk.halted = false;
    watching = null;
    pk.meName = '나';
    t.root.classList.remove('is-watching');
    await standDown(message);
  }

  async function enter(view, { from } = {}) {
    close();
    active = true;
    gone = false;
    code = view.code;
    cursor = null;
    news = null;
    resultShown = false;
    pk.setStakes(view.tier);
    hooks.useStakes?.(view.table);
    if (view.tourney) useBlinds(view.table, view.tier);
    pk.me = view.me;
    pk.clear();
    hooks.showSeated(true);
    const readout = t.root.querySelector('.bet-readout span');
    if (watching && readout) readout.textContent = `${watchName} 스택`;
    t.locked = true;
    t.root.classList.add('is-room');
    const stakes = seven ? formatCH(view.table.ante) : `${formatCH(pk.bb / 2)}/${formatCH(pk.bb)}`;
    pk.meName = watching ? watchName : '나';
    if (watching) setRoomName(`${watchName}님 관전`, stakes);
    else if (view.tourney) setRoomName(...tourneyName(view.table, view));
    else setRoomName('친구 방', stakes);
    t.root.classList.toggle('is-watching', Boolean(watching));
    chipEl.innerHTML = `<span>초대</span><b>${view.code}</b>`;
    chipEl.setAttribute('aria-label', `방 코드 ${view.code}, 친구에게 초대 링크 보내기`);
    chipEl.hidden = Boolean(view.nightly || watching); // the nightly tournament seats whoever registered, nobody by invite
    chat.show(!watching); // the rail can't talk to the table
    await applyRoom(view, null, Date.now());
    // 밤 9시 토너먼트: everyone starts away (their turns play themselves); opening the table takes the seat back.
    if (view.nightly && view.away && !view.tourney?.me?.out && active) await back({ quiet: true });
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
    chat.show(false);
    code = null;
    chipEl.hidden = true;
    hud.hidden = true;
    t.root.classList.remove('is-room', 'is-tourney');
    tableName.textContent = tableNameText;
    if (tableSub) tableSub.innerHTML = tableSubHtml;
    if (message) t.toast(message);
  }

  // Works at any moment, even mid-animation: polling stops at once, and the cash-out plays after
  // whatever is on the felt finishes.
  let leaving = false;
  async function leave() {
    if (watching) return stopWatching();
    if (leaving || !active) return;
    // With chips in a running tournament, getting up is a forfeit.
    const tn = room?.tourney;
    if (room?.nightly && tn && !tn.done && tn.me && !tn.me.out && !confirm('자리를 비울까요? 칩은 그대로 남고, 내 차례는 자동으로 체크/폴드돼요. 홀덤에 다시 오면 이어서 해요.')) return;
    if (!room?.nightly && tn && room.started && !tn.done && tn.me && !tn.me.out && !confirm('지금 일어나면 기권이에요. 칩은 자리에 남아 블라인드로 사라지고, 바이인은 돌려받지 못해요. 그래도 일어날까요?')) return;
    leaving = true;
    const wasBust = bustedNow();
    stop();
    pk.halted = true;
    let res;
    try { res = await api.holdemRoomLeave(code); }
    catch (e) {
      if (e.code !== 'NOT_IN_ROOM' && e.code !== 'ROOM_NOT_FOUND') { pk.halted = leaving = false; t.toast(errorMessage(e)); schedule(); return; }
      res = null;
    }
    active = false; // replies still queued are dropped, and the one on screen stops at its next event
    await applying;
    pk.halted = leaving = false;
    if (res) t.setServerState(res.state);
    const result = res?.result;
    await exit();
    const tr = result?.tourney;
    if (tr && (tr.forfeit || tr.pending || resultShown)) await standDown(tr.away ? '자리를 비웠어요. 홀덤에 다시 오면 이어서 해요' : tr.forfeit ? '기권했어요. 바이인은 상금으로 남아요' : tr.pending ? '탈락했어요. 순위 상금은 토너먼트가 끝나면 정산돼요' : '');
    else if (result) { await hooks.cashOut(result.cashOut, result.netPnl); hooks.refreshActions(); }
    else await standDown(wasBust ? '칩을 모두 잃었어요' : '이미 테이블에서 일어났어요');
  }

  // The table stood me up (out of chips, or away too long): tidy up without a cash-out to show.
  async function standDown(message) {
    try { t.setServerState(await api.state()); } catch {}
    await exit(message || undefined);
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
    try { res = await api.holdemRoom(code, sent, watching); }
    catch (e) {
      if (watching && (/^WATCH_/.test(e.code || '') || e.code === 'ROOM_NOT_FOUND')) { await stopWatching(e.code === 'ROOM_NOT_FOUND' ? '방이 닫혔어요' : e.code === 'WATCH_GONE' ? `${watchName}님이 방에서 나갔어요` : errorMessage(e)); return; }
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
    // 밤 9시 토너먼트: my table broke up and I went to another one, chips and all.
    if (view.movedTo) { await moveTable(view.movedTo); return; }
    if (watching && !view.seated) { await stopWatching(`${watchName}님이 방에서 나갔어요`); return; }
    if (!view.seated && room?.seated) {
      if (bustedNow()) { goneBust(); return; } // the felt keeps the hand that broke me until I get up
      await standDown('테이블에서 일어났어요'); return;
    }
    room = view;
    chat.sync(view.chat);
    dealAt = view.nextAt ? (at ?? Date.now()) + (view.nextAt - view.serverNow) : null;
    let events = view.events;
    // Another reply already played part of this (a poll and a move crossing on the wire).
    if (events && sent && cursor && (sent.hand !== cursor.hand || sent.from !== cursor.from)) {
      events = sent.hand === cursor.hand && view.cursor.hand === cursor.hand && !view.prevCount ? events.slice(Math.max(0, cursor.from - sent.from)) : null;
    }
    if (view.cursor.hand === cursor?.hand && view.cursor.from < cursor.from) events = []; // an older reply
    const reseat = pk.me !== view.me;
    pk.me = view.me;
    if (view.tourney) useBlinds(view.table, view.tier);
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
    if (view.tourney) await tourneyNews(view, at ?? Date.now());
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
    if (view.tourney && !view.started) line = view.isHost ? `초대를 눌러 친구를 불러 주세요 · ${people}/${view.size}명 · 시작하면 늦은 등록은 막혀요` : `방장이 토너먼트를 시작하길 기다리는 중 · ${people}/${view.size}명`;
    else if (!view.started) line = view.isHost ? `초대를 눌러 친구에게 링크를 보내 주세요 · ${people}명 앉음` : `방장이 딜을 시작하길 기다리는 중 · ${people}명 앉음`;
    else if (view.nightly && view.waiting) line = '탈락 · 이 테이블을 지켜보는 중';
    else if (view.nightly && !view.table.handNo) line = '곧 첫 카드가 나가요 · 블라인드는 3분마다 올라요';
    else if (view.waiting) line = watching ? `${watchName}님이 다음 핸드부터 앉아요` : '다음 핸드부터 AI 자리에 앉아요';
    // The players see who is on the rail.
    const rail = (view.watchers || []).filter(w => w.userId !== view.watching?.userId);
    if (!watching && rail.length) line = `${line ? `${line} · ` : ''}👀 ${rail.length === 1 ? `${rail[0].nickname} 관전 중` : `${rail.length}명 관전 중`}`;
    pk.hintLine.hidden = !line;
    pk.hintLine.textContent = line;
  }

  // Out of chips once the hand is over: I stay in the chair (the table stands me up at the next deal).
  let gone = false;
  const bustedNow = () => Boolean(room && !room.tourney && room.me >= 0 && room.table.handOver && (room.table.seats[room.me]?.stack ?? 1) <= 0);
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
  // 7포커's open-card pick is everyone's at once, so it needs no turn of mine.
  const legal = () => (room && room.me >= 0 && !room.table.handOver && (room.table.toAct === room.me || room.table.legal?.phase === 'CHOOSE') && !pk.animating ? room.table.legal : null);

  async function act(action, amount) {
    if (!room || pk.animating || watching) return;
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

  const leaveButton = () => {
    const tn = room?.tourney;
    return { label: tn && room.started && !tn.done ? (room.nightly ? '자리 비우기' : '기권') : '나가기', ghost: true, anytime: true, onClick: leave };
  };
  function refreshActions() {
    const { sizer } = bar;
    const me = room?.table.seats[room.me];
    t.betEl.textContent = formatCH(me?.stack ?? 0);
    if (watching) {
      sizer.hidden = true;
      const tb = room?.table;
      const turnSeat = tb && tb.toAct >= 0 ? tb.seats[tb.toAct] : null;
      t.hint(turnSeat ? `${tb.toAct === room.me ? watchName : turnSeat.name} 차례 · 관전 중` : `${watchName}님 자리 관전 중`);
      t.setActions([{ label: '그만 보기', anytime: true, onClick: () => stopWatching() }, { label: `${watchName}님 자리 관전 중`, ghost: true, disabled: true }]);
      return;
    }
    const l = legal();
    if (l && !pk.animating) {
      const turn = `${room.table.handNo}:${room.table.seq}`;
      const queued = preMove(l);
      // A way out on my own turn too: getting up folds this hand and cashes the stack out.
      t.setActions([leaveButton(), ...bar.actions(l, act)]);
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
      t.hint(l.phase === 'CHOOSE' ? '오픈할 카드 한 장을 눌러 주세요' : '내 차례예요');
      if (prompted !== turn) { prompted = turn; voice.say('your-action', { next: true }); }
      return;
    }
    sizer.hidden = true;
    const tb = room?.table;
    const turnSeat = tb && tb.toAct >= 0 ? tb.seats[tb.toAct] : null;
    t.hint(!room ? '' : tb.phase === 'CHOOSE' && !tb.handOver ? '다른 사람들이 오픈할 카드를 고르고 있어요' : turnSeat ? (tb.toAct === room.me ? '내 차례예요' : `${turnSeat.name} 차례`) : room.started ? '다음 핸드를 곧 돌려요' : '');
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
    const tn = room?.tourney;
    if (tn?.me && tn.me.out && !tn.done) {
      t.hint(`탈락 · ${tn.me.place}위 · 끝까지 지켜볼 수 있어요`);
      t.setActions([...show, { label: '나가기', key: '↵', primary: true, anytime: true, onClick: leave }]);
      return;
    }
    if (tn && room.away) {
      t.hint('자리 비움 · 내 차례는 자동으로 체크/폴드돼요');
      t.setActions([{ label: room.nightly ? '나가기' : '기권', ghost: true, anytime: true, onClick: leave }, { label: '자리로 돌아가기', key: '↵', primary: true, onClick: back }]);
      return;
    }
    if (bustedNow()) {
      t.hint('칩을 모두 잃었어요');
      t.setActions([...show, { label: '나가기', key: '↵', primary: true, anytime: true, onClick: leave }]);
      return;
    }
    t.setActions([
      leaveButton(),
      ...show,
      ...queue,
      ...(room && room.isHost && !room.started ? [{ label: tn ? '토너먼트 시작' : '딜 시작', key: '↵', primary: true, disabled: pk.animating || Boolean(tn && room.players.length < 2), onClick: deal }] : [])
    ]);
  }

  // ---------- tournament ----------
  // The level clock over the felt, the news between hands (a new level, who went out, the final
  // two), and the end: the event result screen with everyone's places, then back to the solo table.
  const hud = el('div', 'royale-hud pk-tourney-hud');
  hud.hidden = true;
  hud.setAttribute('role', 'status');
  t.body.querySelector('.pk').append(hud);
  let hudTimer = 0, skew = 0;
  let news = null; // { level, out, left }: what this screen has already announced
  let resultShown = false;
  const tourneyName = (tb, v = room) => [v?.nightly ? `${v.tourney?.label || '밤 9시'} 토너먼트` : '친구 토너먼트', `${formatCH(tb.smallBlind)}/${formatCH(tb.bigBlind)}`];
  async function moveTable(to) {
    stop();
    let res;
    try { res = await api.holdemRoom(to); } catch (e) { await standDown(errorMessage(e)); return; }
    sound.tick();
    await enter(res.room);
    t.banner('테이블 이동', 'push');
    t.toast('인원이 줄어서 다른 테이블로 옮겼어요. 칩은 그대로예요');
  }
  function useBlinds(tb, tier) {
    pk.bb = tb.bigBlind;
    pk.chipSet = [pk.bb, ...(TIERS[tier] || t.tier).chips.filter(v => v > pk.bb)];
  }
  const clockText = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function paintHud() {
    const tn = room?.tourney;
    t.root.classList.toggle('is-tourney', Boolean(tn));
    hud.hidden = !tn;
    if (!tn) return;
    let when;
    if (!room.started) when = `${Math.round(tn.levelMs / 60000)}분마다 블라인드 상승`;
    else if (tn.done) when = '종료';
    else if (!tn.levelEndsAt) when = '마지막 레벨';
    else {
      const left = tn.levelEndsAt - (Date.now() - skew);
      when = left > 0 ? `다음 레벨까지 ${clockText(left)}` : `다음 핸드부터 레벨 ${tn.level + 1}`;
    }
    const next = tn.next ? `다음 ${formatCH(tn.next.small)}/${formatCH(tn.next.big)}` : '최고 블라인드';
    const field = room.started ? `<b>${tn.left}/${tn.entrants}</b><i class="pk-hud-long"> 남음${tn.tables > 1 ? ` · 테이블 ${tn.tables}` : ''}</i> · ` : `<b>${tn.people}/${room.size}</b>명 · `;
    hud.innerHTML = `<span><b>레벨 ${tn.level}</b> · ${when}</span><span>${next}</span><span>${field}상금 <b>${formatCH(tn.prize)}</b></span>`;
  }
  function paintTourney(view, at) {
    skew = at - view.serverNow;
    paintHud();
    clearInterval(hudTimer);
    if (view.started && !view.tourney.done) hudTimer = setInterval(() => { if (active && !document.hidden) paintHud(); }, 1000);
  }

  async function tourneyNews(view, at) {
    const tn = view.tourney;
    paintTourney(view, at);
    setRoomName(...tourneyName(view.table, view));
    const first = !news;
    // Eliminations by who and when, not by count: a nightly table's list drops chairs others moved into.
    const outKey = o => `${o.seat}:${o.hand}:${o.name}`;
    const seen = news || { level: tn.level, out: new Set(tn.out.map(outKey)), left: tn.left };
    news = { level: tn.level, out: new Set([...seen.out, ...tn.out.map(outKey)]), left: tn.left };
    if (!first && active) {
      if (tn.level > seen.level) { t.banner(`Level ${tn.level}`, 'push'); t.toast(`블라인드가 ${formatCH(tn.small)}/${formatCH(tn.big)}로 올랐어요`); sound.tick(); await wait(700); }
      for (const o of tn.out.filter(x => !seen.out.has(outKey(x)))) {
        if (!active) return;
        const row = o.kind === 'human' ? tn.standings.find(r => r.userId === view.table.seats[o.seat]?.id) : null;
        const mine = o.seat === view.me;
        if (mine && !tn.done) { t.banner(`${row?.place ?? ''}위로 탈락`, 'lose'); await wait(900); }
        else if (!mine) { t.toast(row?.place ? `${o.name} 탈락 · ${row.place}위` : `${o.name} 탈락`); await wait(600); }
      }
      if (!tn.done && tn.left === 2 && seen.left > 2) { t.banner('HEADS-UP 결승', 'push'); sound.tick(); await wait(900); }
    }
    // The nightly field is paid the moment a place is known, so a bust there ends my night at once.
    if ((tn.done || (view.nightly && tn.me?.out)) && !resultShown && active) {
      resultShown = true;
      await tourneyOver(view);
    }
  }

  // The tournament is decided: places on the result screen, then a quiet goodbye to the room.
  async function tourneyOver(view) {
    const tn = view.tourney, me = tn.me;
    stop();
    await wait(1200); // let the deciding hand sit on the felt a moment
    if (me) {
      const net = (me.payout || 0) - view.buyIn;
      const win = me.place === 1 || net > 0;
      const rows = tn.standings.filter(r => !view.nightly || r.place).map(r => ({ place: r.place, name: r.me ? `${r.nickname} (나)` : r.nickname, note: r.forfeit ? '기권' : r.payout ? `+${formatCH(r.payout)}` : '', me: r.me }));
      const detail = me.payout ? `상금 ${formatCH(me.payout)} · 바이인 ${formatCH(view.buyIn)}` : `바이인 ${formatCH(view.buyIn)}`;
      await eventResult({ event: 'friends', win, title: view.nightly ? `${tn.label || '밤 9시'} 토너먼트` : '친구 토너먼트', place: me.place, amount: Math.abs(net), detail, nickname: t.nickname, rows });
    }
    let res = null;
    try { res = await api.holdemRoomLeave(code); } catch {}
    if (res) t.setServerState(res.state);
    await standDown('');
  }

  async function back({ quiet = false } = {}) {
    const sent = cursor && { ...cursor };
    let res;
    try { res = await api.holdemRoomBack(code, sent); }
    catch (e) { if (!quiet) t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    t.toast(quiet ? `${room?.tourney?.label || '밤 9시'} 토너먼트 자리에 앉았어요` : '자리로 돌아왔어요');
    await enqueue(res.room, sent, Date.now());
  }

  // Plates: my friends by nickname with a star, bots by name and temperament.
  const baseName = pk.nameOf, baseNote = pk.noteOf;
  pk.nameOf = (i, s) => (active && i === pk.me ? pk.meName : active ? s.name : baseName(i, s));
  pk.noteOf = (i, s) => {
    if (!active) return baseNote(i, s);
    if (room?.tourney?.out.some(o => o.seat === i)) return '탈락';
    if (s.kind === 'human') return room?.nightly ? '플레이어' : room?.hostId === s.id ? '방장' : '친구';
    return s.kind === 'bot' ? `AI · ${STYLE_LABEL[s.style] || ''}` : '';
  };

  function stop() {
    clearTimeout(pollTimer);
    clearInterval(listTimer);
    clearInterval(hudTimer);
    pk.clock(-1);
  }

  return {
    get active() { return active; },
    legal, refreshActions, open, resume, act, view: () => room, street: () => room?.table.street,
    onBetChange: () => { if (!panel.hidden) paintCreate(); },
    stop: () => { stop(); active = false; chat.destroy(); document.removeEventListener('visibilitychange', onVisible); }
  };
}
