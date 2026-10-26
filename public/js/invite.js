// Invite links for friends' rooms: one link that opens the right game and sits the friend down.
// A link looks like /?join=ABCD&g=seotda&t=gold-room. The app keeps it until the friend has signed
// in and the game screen asks for it (takePendingJoin), so signing up first still works.
const KEY = 'vegas:pending-join';
const ROOM_GAMES = { holdem: 'poker', seotda: 'seotda', gostop: 'gostop', matgo: 'matgo', blackjack: 'blackjack', baccarat: 'baccarat' };

// Invite links go to /j: the server gives that page a 카카오톡 preview naming who invited the friend
// to which game (lib/link-preview.mjs). `r` is my invite code, so the friend's first round pays us
// both (lib/referral.mjs).
const REF_KEY = 'vegas:ref';
let myCode = null;
export function setMyInviteCode(code) { myCode = code || null; }

export function inviteUrl(game, code, tier) {
  const url = new URL('/j', location.origin);
  url.searchParams.set('join', code);
  url.searchParams.set('g', game);
  if (tier) url.searchParams.set('t', tier);
  if (myCode) url.searchParams.set('r', myCode);
  return url.href;
}

export function friendInviteUrl() {
  const url = new URL('/j', location.origin);
  if (myCode) url.searchParams.set('r', myCode);
  return url.href;
}

// The invite code a friend's link brought, kept until this phone makes an account or a guest.
export function pendingRef() {
  try {
    const v = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
    return v && Date.now() - v.at < 30 * 86_400_000 ? v.code : null;
  } catch { return null; }
}
export function dropPendingRef() { try { localStorage.removeItem(REF_KEY); } catch {} }

// The plain friend invite: the share sheet, or the clipboard.
export async function shareFriendInvite({ reward, toast }) {
  const url = friendInviteUrl();
  const text = `VEGAS에서 같이 한 판 해요! 가입 없이 바로 시작하고, 첫 판 끝나면 우리 둘 다 ${reward} 칩 받아요.`;
  if (navigator.share) {
    try { await navigator.share({ title: 'VEGAS 초대', text, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('초대 링크를 복사했어요. 친구에게 보내 주세요'); }
  catch { toast(url); }
}

// The share sheet on phones (카카오톡, 문자), or the clipboard elsewhere.
export async function shareInvite({ game, label, code, tier, toast }) {
  const url = inviteUrl(game, code, tier);
  const text = `VEGAS ${label} 같이 해요! 방 코드 ${code}. 가입 없이 바로 앉을 수 있어요.`;
  if (navigator.share) {
    try { await navigator.share({ title: `VEGAS ${label} 초대`, text, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('초대 링크를 복사했어요. 친구에게 보내 주세요'); }
  catch { toast(`방 코드 ${code}`); }
}

// On page load: lift an invite out of the address bar and keep it for after sign-in.
export function capturePendingJoin() {
  const params = new URLSearchParams(location.search);
  const code = String(params.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const game = params.get('g');
  const ref = String(params.get('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  // A 자랑하기 card's link names the player who shared it (?from=nickname): that counts as an invite too.
  const from = String(params.get('from') || '').trim().slice(0, 12);
  const keep = ref.length >= 4 ? ref : from ? `@${from}` : '';
  if (keep) { try { localStorage.setItem(REF_KEY, JSON.stringify({ code: keep, at: Date.now() })); } catch {} }
  if (code.length === 4 && ROOM_GAMES[game]) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ code, game, tier: params.get('t') || null })); } catch {}
  }
  return pendingJoin();
}

export function pendingJoin() {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return v && ROOM_GAMES[v.game] ? { ...v, screen: ROOM_GAMES[v.game] } : null; }
  catch { return null; }
}

// The game screen takes the invite meant for it (once).
export function takePendingJoin(game) {
  const v = pendingJoin();
  if (!v || v.game !== game) return null;
  try { sessionStorage.removeItem(KEY); } catch {}
  return v.code;
}
export function dropPendingJoin() { try { sessionStorage.removeItem(KEY); } catch {} }
