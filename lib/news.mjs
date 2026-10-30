// Big news on the floor: a jackpot, a huge win, the season's winner, a duel aimed at you.
// Each item becomes a banner at the top of the app for everyone who has it open, and the
// biggest ones (push: true) also go out as push notifications to everyone who doesn't.
import { formatWon } from './notifications.mjs';
import { reactionNews } from './brag.mjs';

const GAME_NAMES = { Blackjack: '블랙잭', Baccarat: '바카라', Roulette: '룰렛', 'Sic Bo': '식보', Matgo: '맞고', Gostop: '고스톱', Seotda: '섯다', "Hold'em": '홀덤', 'Seven Poker': '7포커', Slots: '슬롯', 'Horse Racing': '경마', Double: '묻고 더블' };
const gameName = g => GAME_NAMES[g] || g || '테이블';
const METRICS = { QUALIFIED_PROFIT: '수익', WINS: '승리 수' };
// Big wins and busts are the headline news (한서's call). A hot win goes to phones when it is
// 10억+ or 10x+; every bust does.
export const PUSH_WIN = 1_000_000_000;
export const PUSH_MULTIPLE = 10;
const LIMIT = 10;

// 을/를 after a Korean word: 을 when its last syllable closes on a consonant.
export function objectParticle(word) {
  const c = String(word || '').trim().slice(-1).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '을' : '를';
}

// Older BIG_LOSS rows only kept a sentence with the loss spelled out as 3,000,000,000원.
export function bigLossText(who, f) {
  const amount = Number(f.amount) || Number(String(f.text || '').match(/([\d,]{5,})원/)?.[1].replace(/,/g, '')) || 0;
  const game = f.game || String(f.text || '').match(/님이 (.+?)에서 /)?.[1];
  if (!amount) return `${who}님이 큰 판에서 졌어요.`;
  return `${who}님이 ${game && game !== '큰 판' ? gameName(game) : '큰 판'}에서 ${formatWon(amount)}${objectParticle(formatWon(amount))} 잃었어요.`;
}

function nick(state, userId) { return state.users[userId]?.nickname || '누군가'; }

function feedItem(state, f, me) {
  const who = nick(state, f.actorId), mine = f.actorId === me;
  const base = { id: f.id, type: f.type, at: f.createdAt, mine, reactable: !mine && Boolean(f.actorId) };
  switch (f.type) {
    case 'JACKPOT':
      return mine ? null : { ...base, title: '잭팟이 터졌어요', body: `${who}님이 슬롯 잭팟 ${formatWon(f.amount)}을 가져갔어요.`, push: true };
    case 'HOT_WIN': {
      if (mine) return null;
      const how = f.multiple >= 5 ? `${f.multiple}배 적중, ` : '';
      return { ...base, title: `${who}님 대박`, body: `${gameName(f.game)}에서 ${how}+${formatWon(f.amount)}`, push: f.amount >= PUSH_WIN || f.multiple >= PUSH_MULTIPLE };
    }
    case 'SEASON_WINNER':
      return mine
        ? { ...base, title: '시즌 1위, 축하해요', body: `${f.season} 우승이에요. 상금이 지갑에 들어갔어요.`, push: true }
        : { ...base, title: `${f.season} 우승자 발표`, body: `${who}님이 1위를 차지했어요. 새 시즌이 시작됐어요.`, push: true };
    case 'DAILY_STREAK':
      return mine ? null : { ...base, title: '금고가 열렸어요', body: `${who}님이 7일 연속 출석으로 금고를 열었어요.`, push: false };
    case 'FLOOR_UNLOCK': {
      if (mine) return null;
      const floor = String(f.text || '').match(/ unlocked (.+)\.$/)?.[1];
      return floor ? { ...base, title: '새 층 입성', body: `${who}님이 ${floor} 층에 올라섰어요.`, push: false } : null;
    }
    case 'BANKRUPTCY':
      return mine ? null : { ...base, title: `${who}님 파산`, body: f.amount ? `${gameName(f.game)}에서 ${formatWon(f.amount)} 날리고 빈털터리가 됐어요. 놀리러 가요.` : `${who}님이 칩을 전부 잃었어요. 놀리러 가요.`, push: true };
    case 'BIG_LOSS':
      return mine ? null : { ...base, title: '큰 판이 무너졌어요', body: bigLossText(who, f), push: false };
    case 'CHALLENGE_WON':
      // Duel results for the two players come from the duel itself (below), with their own wording.
      return mine || f.opponent === state.users[me]?.nickname ? null : { ...base, title: '대결 결과', body: `${who}님이 ${f.opponent}님과의 대결에서 이겼어요.`, push: false };
    default:
      return null;
  }
}

function duelItems(state, me, since) {
  const out = [];
  for (const c of state.socialCompetition?.challenges || []) {
    if (c.challengerId !== me && c.opponentId !== me) continue;
    const other = nick(state, c.challengerId === me ? c.opponentId : c.challengerId);
    const metric = METRICS[c.metric] || '기록';
    if (c.status === 'PENDING' && c.opponentId === me && Date.parse(c.createdAt) > since) {
      out.push({ id: `${c.id}:in`, type: 'DUEL_IN', at: c.createdAt, mine: false, title: `${other}님이 대결을 신청했어요`, body: `7일 동안 ${metric} 대결, 이기면 1억원. 들어와서 받아 주세요.`, push: true });
    }
    if (c.status === 'ACTIVE' && c.challengerId === me && c.startsAt && Date.parse(c.startsAt) > since) {
      out.push({ id: `${c.id}:on`, type: 'DUEL_ON', at: c.startsAt, mine: false, title: `${other}님이 대결을 받았어요`, body: `지금부터 7일, ${metric}로 겨뤄요.`, push: true });
    }
    if (c.status === 'COMPLETED' && Date.parse(c.updatedAt) > since) {
      const won = c.winnerId === me, draw = !c.winnerId;
      out.push({ id: `${c.id}:end`, type: 'DUEL_END', at: c.updatedAt, mine: false, title: draw ? `${other}님과 비겼어요` : won ? `${other}님을 이겼어요` : `${other}님에게 졌어요`, body: draw ? '대결이 무승부로 끝났어요.' : won ? '대결 상금 1억원이 지갑에 들어갔어요.' : '다음 대결에서 갚아 줘요.', push: true });
    }
  }
  return out;
}

// 1:1 도전 (lib/challenge.mjs): a friend's challenge waiting for me, with the seat to take.
const CHALLENGE_LABEL = { matgo: '맞고 한 판', holdem: '홀덤 10핸드' };
function challengeItems(state, me, since) {
  const rooms = [...(Array.isArray(state.tableRooms) ? state.tableRooms : []), ...(Array.isArray(state.holdemRooms) ? state.holdemRooms : [])];
  return rooms.filter(r => r.status === 'OPEN' && r.challenge?.to === me && !r.challenge.acceptedAt && !r.challenge.done && Date.parse(r.challenge.createdAt) > since)
    .map(r => {
      const stake = r.challenge.game === 'holdem' ? `바이인 ${formatWon(r.buyIn)}` : `점당 ${formatWon(r.stake)}`;
      return {
        id: `${r.id}:challenge`, type: 'DUEL_ROOM', at: r.challenge.createdAt, mine: false, push: true,
        title: `${r.challenge.fromName}님의 도전: ${CHALLENGE_LABEL[r.challenge.game]}`,
        body: `${stake}. 30분 안에 받으면 바로 시작해요.`,
        join: { code: r.code, game: r.challenge.game, tier: r.tier, floor: r.floor ?? null },
        url: `./?join=${r.code}&g=${r.challenge.game}${r.tier ? `&t=${r.tier}` : ''}`
      };
    });
}

// What `userId` hasn't heard about since `since` (ms), newest first.
export function newsFor(state, userId, since) {
  const feed = (state.feed || []).filter(f => Date.parse(f.createdAt) > since).map(f => feedItem(state, f, userId)).filter(Boolean);
  return [...feed, ...duelItems(state, userId, since), ...challengeItems(state, userId, since), ...reactionNews(state, userId, since)].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, LIMIT);
}
