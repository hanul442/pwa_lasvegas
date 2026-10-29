// 친구 목록 on 랭킹 → 친구 (lib/friends.mjs): who is here right now and where they sit, a seat
// next to them when their room has one free, a nudge link for friends who aren't around, and
// adding a friend by name. The list refreshes every 20 s while it is on screen.
import { api, errorMessage } from './api.js';
import { formatCH } from './fx.js';
import { friendInviteUrl } from './invite.js';

const REFRESH_MS = 20_000;
let timer = null, box = null, opts = null, last = null;

function ago(iso) {
  if (!iso) return '접속 기록 없음';
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? '방금 전' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WHY = { played: '같이 친 친구', invite: '초대로 만난 친구', added: '내가 추가한 친구' };

function whereText(f) {
  const w = f.where;
  if (!f.online) return `${ago(f.lastSeenAt)} 접속`;
  if (!w) return '로비에 있어요';
  if (w.kind === 'solo') return `${w.name} 치는 중`;
  return `${w.name} 친구방 ${w.people}/${w.size}${w.stake ? ` · ${formatCH(w.stake)}` : ''}`;
}

function rowHtml(f) {
  const w = f.where;
  const join = f.online && w?.kind === 'room' && w.open ? `<button type="button" class="pill-button pill-button--solid friend-act" data-join="${esc(f.id)}">옆자리</button>` : '';
  const call = !f.online ? `<button type="button" class="pill-button friend-act" data-call="${esc(f.id)}">부르기</button>` : '';
  const record = f.won + f.lost ? ` · ${f.won}승 ${f.lost}패` : '';
  return `<li class="friend-row friend-live${f.online ? ' is-online' : ''}">
    <span class="friend-mono" aria-hidden="true">${esc([...(f.nickname || '?')][0])}<i class="friend-dot"></i></span>
    <span class="friend-main"><b>${opts.frame(f.id, esc(f.nickname))}</b><small>${f.online ? '<em>접속 중</em> · ' : ''}${esc(whereText(f))}${record}</small></span>
    <span class="friend-acts">${join}${call}${f.why === 'added' ? `<button type="button" class="friend-x" data-remove="${esc(f.id)}" aria-label="${esc(f.nickname)} 친구 삭제">×</button>` : ''}</span>
  </li>`;
}

function paint(data) {
  if (!box) return;
  last = data;
  const list = data?.list || [];
  box.innerHTML = `
    <h2 class="sub-head">친구 <small>${list.length ? `${data.online}명 접속 중` : ''}</small></h2>
    ${list.length ? `<ul class="friend-list">${list.map(rowHtml).join('')}</ul>` : '<p class="friend-note">같이 친 사람, 초대로 만난 사람이 여기 모여요. 닉네임으로 바로 추가해도 돼요.</p>'}
    <form class="friend-add" data-friend-add>
      <input name="nickname" aria-label="친구 닉네임" maxlength="16" autocomplete="off" spellcheck="false" placeholder="닉네임">
      <button type="submit" class="pill-button">친구 추가</button>
    </form>
    <p class="friend-note">친구가 오랜만에 들어오면 알림으로 알려 드려요 (밤 10시~아침 9시 제외).</p>`;
  box.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', () => {
    const f = list.find(x => x.id === b.dataset.join);
    if (f?.where) opts.onJoin(f.where);
  }));
  box.querySelectorAll('[data-call]').forEach(b => b.addEventListener('click', () => callFriend(list.find(x => x.id === b.dataset.call))));
  box.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
    try { paint((await api.friendRemove(b.dataset.remove)).friends); } catch (e) { opts.toast(errorMessage(e)); }
  }));
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
  try { paint((await api.friends()).friends); } catch {}
}

// Draws the list into `target` and keeps it fresh until stopFriends().
// o: { frame(id, name) → html, onJoin(where), toast(msg) }
export function showFriends(target, o) {
  box = target;
  opts = o;
  if (last) paint(last); else box.innerHTML = '<h2 class="sub-head">친구</h2><p class="friend-note">불러오는 중…</p>';
  load();
  clearInterval(timer);
  timer = setInterval(() => { if (box?.isConnected && !box.closest('[hidden]')) load(); else stopFriends(); }, REFRESH_MS);
}
export function stopFriends() { clearInterval(timer); timer = null; }
