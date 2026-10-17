// Invite links for friends' rooms: one link that opens the right game and sits the friend down.
// A link looks like /?join=ABCD&g=seotda&t=gold-room. The app keeps it until the friend has signed
// in and the game screen asks for it (takePendingJoin), so signing up first still works.
const KEY = 'vegas:pending-join';
const ROOM_GAMES = { holdem: 'poker', seotda: 'seotda', gostop: 'gostop', matgo: 'matgo', blackjack: 'blackjack' };

export function inviteUrl(game, code, tier) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('join', code);
  url.searchParams.set('g', game);
  if (tier) url.searchParams.set('t', tier);
  return url.href;
}

// The share sheet on phones (카카오톡, 문자), or the clipboard elsewhere.
export async function shareInvite({ game, label, code, tier, toast }) {
  const url = inviteUrl(game, code, tier);
  const text = `VEGAS ${label} 같이 해요! 방 코드 ${code}`;
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
