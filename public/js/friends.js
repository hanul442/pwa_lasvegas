// 친구 목록 on 랭킹 → 친구 (lib/friends.mjs): who is here right now and where they sit. Each row
// keeps one quick button (옆자리, 관전 or 도전) and opens into the rest: 1:1 도전 (lib/challenge.mjs,
// 맞고 한 판 or 홀덤 10핸드 at a floor I can pay for), 관전 over their shoulder (lib/watch.mjs), a
// nudge link, and taking them off. Challenges waiting on me sit on top. Refreshes every 20 s.
import { api, errorMessage } from './api.js';
import { formatCH } from './fx.js';
import { friendInviteUrl } from './invite.js';
import { TIERS } from './chips.js';

const REFRESH_MS = 20_000;
const GAMES = [['matgo', '맞고 한 판'], ['holdem', '홀덤 10핸드']];
let timer = null, box = null, opts = null, last = null, extra = { challenges: [], options: {} };
let openId = null, pickGame = 'matgo', pickTier = null;

function ago(iso) {
  if (!iso) return '접속 기록 없음';
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? '방금 전' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tierName = slug => TIERS[slug]?.name || slug;
const minutesLeft = ms => Math.max(1, Math.ceil((ms - Date.now()) / 60_000));

function whereText(f) {
  const w = f.where;
  if (!f.online) return `${ago(f.lastSeenAt)} 접속`;
  if (!w) return '로비에 있어요';
  if (w.kind === 'solo') return `${w.name} 치는 중`;
  if (w.challenge) return `${w.name} 1:1 도전 중`;
  return `${w.name} 친구방 ${w.people}/${w.size}${w.stake ? ` · ${formatCH(w.stake)}` : ''}`;
}

const canJoin = f => f.online && f.where?.kind === 'room' && f.where.open;
const canWatch = f => f.online && f.where?.kind === 'room' && f.where.watchable && f.where.started;
function quick(f) {
  if (canJoin(f)) return `<button type="button" class="pill-button pill-button--solid friend-act" data-join="${esc(f.id)}">옆자리</button>`;
  if (canWatch(f)) return `<button type="button" class="pill-button friend-act" data-watch="${esc(f.id)}">관전</button>`;
  return `<button type="button" class="pill-button friend-act" data-open="${esc(f.id)}">도전</button>`;
}

function challengePanel(f) {
  const options = extra.options?.[pickGame] || [];
  if (!options.some(o => o.tier === pickTier)) pickTier = options[0]?.tier || null;
  const pick = options.find(o => o.tier === pickTier);
  const stake = pick ? (pickGame === 'matgo' ? `점당 ${formatCH(pick.stake)} · 보증금 ${formatCH(pick.need)}` : `바이인 ${formatCH(pick.stake)} · 둘이서만`) : '';
  return `<div class="friend-panel">
    <div class="friend-seg" role="radiogroup" aria-label="도전 게임">${GAMES.map(([g, label]) => `<button type="button" role="radio" aria-checked="${g === pickGame}" data-game="${g}">${label}</button>`).join('')}</div>
    ${options.length
      ? `<div class="friend-tiers" role="radiogroup" aria-label="판돈">${options.map(o => `<button type="button" role="radio" aria-checked="${o.tier === pickTier}" data-tier="${o.tier}">${esc(tierName(o.tier))}</button>`).join('')}</div>
         <p class="friend-note">${stake}. 30분 안에 ${esc(f.nickname)}님이 받으면 바로 시작해요.</p>
         <button type="button" class="pill-button pill-button--solid friend-send" data-send="${esc(f.id)}">${esc(f.nickname)}님에게 도전 보내기</button>`
      : '<p class="friend-note">지금 칩으로는 이 게임 자리를 못 잡아요.</p>'}
    <div class="friend-more">
      ${canWatch(f) ? `<button type="button" class="link-button" data-watch="${esc(f.id)}">관전</button>` : ''}
      ${!f.online ? `<button type="button" class="link-button" data-call="${esc(f.id)}">카톡으로 부르기</button>` : ''}
      ${f.why === 'added' ? `<button type="button" class="link-button" data-remove="${esc(f.id)}">친구 삭제</button>` : ''}
    </div>
  </div>`;
}

function rowHtml(f) {
  const record = f.won + f.lost ? ` · ${f.won}승 ${f.lost}패` : '';
  const open = openId === f.id;
  return `<li class="friend-row friend-live${f.online ? ' is-online' : ''}${open ? ' is-open' : ''}">
    <button type="button" class="friend-toggle" data-open="${esc(f.id)}" aria-expanded="${open}">
      <span class="friend-mono" aria-hidden="true">${esc([...(f.nickname || '?')][0])}<i class="friend-dot"></i></span>
      <span class="friend-main"><b>${opts.frame(f.id, esc(f.nickname))}</b><small>${f.online ? '<em>접속 중</em> · ' : ''}${esc(whereText(f))}${record}</small></span>
    </button>
    <span class="friend-acts">${quick(f)}</span>
    ${open ? challengePanel(f) : ''}
  </li>`;
}

function challengeRow(c) {
  const what = `${c.label} · ${tierName(c.tier)} ${c.game === 'matgo' ? `점당 ${formatCH(c.stake)}` : `바이인 ${formatCH(c.stake)}`}`;
  return c.incoming
    ? `<li class="friend-row friend-duel is-in"><span class="friend-main"><b>${esc(c.from)}님의 도전</b><small>${esc(what)} · ${minutesLeft(c.expiresAt)}분 남음</small></span><span class="friend-acts"><button type="button" class="pill-button pill-button--solid friend-act" data-accept="${esc(c.code)}">받기</button></span></li>`
    : `<li class="friend-row friend-duel"><span class="friend-main"><b>${esc(c.to)}님을 기다려요</b><small>${esc(what)} · ${minutesLeft(c.expiresAt)}분 남음</small></span><span class="friend-acts"><button type="button" class="pill-button friend-act" data-accept="${esc(c.code)}">테이블로</button></span></li>`;
}

function paint(data) {
  if (!box) return;
  last = data;
  const list = data?.list || [];
  const duels = extra.challenges || [];
  box.innerHTML = `
    ${duels.length ? `<h2 class="sub-head">1:1 도전</h2><ul class="friend-list">${duels.map(challengeRow).join('')}</ul>` : ''}
    <h2 class="sub-head">친구 <small>${list.length ? `${data.online}명 접속 중` : ''}</small></h2>
    ${list.length ? `<ul class="friend-list">${list.map(rowHtml).join('')}</ul>` : '<p class="friend-note">같이 친 사람, 초대로 만난 사람이 여기 모여요. 닉네임으로 바로 추가해도 돼요.</p>'}
    <form class="friend-add" data-friend-add>
      <input name="nickname" aria-label="친구 닉네임" maxlength="16" autocomplete="off" spellcheck="false" placeholder="닉네임">
      <button type="submit" class="pill-button">친구 추가</button>
    </form>
    <p class="friend-note">친구 이름을 누르면 맞고 한 판이나 홀덤 10핸드로 도전할 수 있어요. 친구가 오랜만에 들어오면 알림도 와요 (밤 10시~아침 9시 제외).</p>`;
  const find = id => list.find(x => x.id === id);
  const on = (sel, fn) => box.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => fn(b)));
  on('[data-open]', b => { openId = openId === b.dataset.open ? null : b.dataset.open; paint(last); });
  on('[data-game]', b => { pickGame = b.dataset.game; paint(last); });
  on('[data-tier]', b => { pickTier = b.dataset.tier; paint(last); });
  on('[data-join]', b => { const f = find(b.dataset.join); if (f?.where) opts.onJoin(f.where); });
  on('[data-watch]', b => { const f = find(b.dataset.watch); if (f?.where) opts.onWatch(f.where, f); });
  on('[data-call]', b => callFriend(find(b.dataset.call)));
  on('[data-accept]', b => { const c = duels.find(x => x.code === b.dataset.accept); if (c) opts.onJoin({ code: c.code, game: c.game, tier: c.tier, floor: c.floor }); });
  on('[data-send]', async b => {
    b.disabled = true;
    try {
      const out = await api.friendChallenge(b.dataset.send, pickGame, pickTier);
      openId = null;
      opts.onState?.(out.state);
      opts.toast(`${find(b.dataset.send)?.nickname || '친구'}님에게 도전을 보냈어요. 테이블에서 기다려요`);
      opts.onJoin(out.room);
    } catch (e) { b.disabled = false; opts.toast(errorMessage(e)); }
  });
  on('[data-remove]', async b => {
    try { openId = null; paint((await api.friendRemove(b.dataset.remove)).friends); } catch (e) { opts.toast(errorMessage(e)); }
  });
  box.querySelector('[data-friend-add]').addEventListener('submit', async e => {
    e.preventDefault();
    const input = e.currentTarget.nickname;
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    try {
      const out = await api.friendAdd(name);
      paint(out.friends);
      opts.toast(`${name}님을 친구로 추가했어요`);
    } catch (err) { opts.toast(errorMessage(err)); }
  });
}

// "같이 한 판 해요" to a friend who isn't around: 카카오톡 or 문자 through the share sheet.
async function callFriend(f) {
  if (!f) return;
  const url = friendInviteUrl();
  const text = `${f.nickname}님, VEGAS에서 같이 한 판 해요! 들어오면 친구 탭에서 바로 만나요.`;
  if (navigator.share) {
    try { await navigator.share({ title: 'VEGAS', text, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); opts.toast('부르는 메시지를 복사했어요. 친구에게 보내 주세요'); }
  catch { opts.toast(url); }
}

async function load() {
  if (!box || document.hidden) return;
  // Not while a challenge is being picked: a redraw would close the panel under the thumb.
  if (openId && last) return;
  try {
    const out = await api.friends();
    extra = { challenges: out.challenges || [], options: out.challengeOptions || {} };
    paint(out.friends);
  } catch {}
}

// Draws the list into `target` and keeps it fresh until stopFriends().
// o: { frame(id, name) → html, onJoin(where), onWatch(where, friend), onState(state), toast(msg) }
export function showFriends(target, o) {
  box = target;
  opts = o;
  openId = null;
  if (last) paint(last); else box.innerHTML = '<h2 class="sub-head">친구</h2><p class="friend-note">불러오는 중…</p>';
  load();
  clearInterval(timer);
  timer = setInterval(() => { if (box?.isConnected && !box.closest('[hidden]')) load(); else stopFriends(); }, REFRESH_MS);
}
export function stopFriends() { clearInterval(timer); timer = null; }
