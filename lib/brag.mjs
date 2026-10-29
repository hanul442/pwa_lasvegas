// 동네방네: other players cheer (👏), hype (🔥) or laugh at (😂) each moment in the lounge feed,
// and the one whose moment it was hears about it. One reaction per player per moment. The client
// sends the reaction it wants to end up with ('' takes it back), so a retried request is harmless.
export const REACTIONS = { clap: '👏', fire: '🔥', lol: '😂' };
const MAX_PER_ITEM = 200;

export function reactToFeed(state, user, feedId, kind) {
  const f = (state.feed || []).find(x => x.id === feedId);
  if (!f) throw new Error('FEED_NOT_FOUND');
  if (kind && !REACTIONS[kind]) throw new Error('BAD_REACTION');
  if (f.actorId === user.id) throw new Error('OWN_MOMENT');
  if (!f.actorId) throw new Error('FEED_NOT_FOUND');
  const r = f.reactions && typeof f.reactions === 'object' ? f.reactions : (f.reactions = {});
  if (!kind) delete r[user.id];
  else if (r[user.id]?.k !== kind) {
    if (!r[user.id] && Object.keys(r).length >= MAX_PER_ITEM) throw new Error('FEED_FULL');
    r[user.id] = { k: kind, at: new Date().toISOString() };
  }
  return reactionSummary(f, user.id);
}

// Counts per kind and what the viewer picked; who reacted stays on the server.
export function reactionSummary(f, viewerId) {
  const counts = { clap: 0, fire: 0, lol: 0 };
  let mine = null;
  for (const [uid, r] of Object.entries(f?.reactions || {})) {
    if (!REACTIONS[r?.k]) continue;
    counts[r.k]++;
    if (uid === viewerId) mine = r.k;
  }
  return { counts, mine };
}

const WHAT = { HOT_WIN: '대박', JACKPOT: '잭팟', BANKRUPTCY: '파산', FLOOR_UNLOCK: '새 층 입성', SEASON_WINNER: '시즌 우승', DAILY_STREAK: '금고', MONTHLY_PAY: '월급', ACHIEVEMENT: '업적', BIG_LOSS: '큰 판', CHALLENGE_WON: '대결 승리' };

// News for `me`: reactions others left on my moments since `since` (ms), one item per moment.
export function reactionNews(state, me, since) {
  const out = [];
  for (const f of state.feed || []) {
    if (f.actorId !== me || !f.reactions) continue;
    const fresh = Object.entries(f.reactions)
      .filter(([uid, r]) => uid !== me && REACTIONS[r?.k] && Date.parse(r.at) > since)
      .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at));
    if (!fresh.length) continue;
    const [uid, last] = fresh[0];
    const who = state.users[uid]?.nickname || '누군가';
    const what = WHAT[f.type] || '소식';
    const emojis = [...new Set(fresh.map(([, r]) => REACTIONS[r.k]))].join('');
    out.push({
      id: `react:${f.id}:${last.at}`, type: 'REACTION', at: last.at, mine: false, push: false,
      title: fresh.length > 1 ? `${who}님 외 ${fresh.length - 1}명이 반응했어요 ${emojis}` : `${who}님이 ${REACTIONS[last.k]}`,
      body: f.type === 'BANKRUPTCY' ? `내 ${what} 소식에 반응했어요. 다시 일어나서 보여 줘요.` : `내 ${what} 소식에 반응했어요. 동네방네 소문났어요.`
    });
  }
  return out;
}
