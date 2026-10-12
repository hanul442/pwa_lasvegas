// Thin client for the server-authoritative game API.
import { API_BASE } from './config.js';

const PLAYER_KEY = 'vegas:player';
const SESSION_KEY = 'vegas:session';

// The signed-in player's id, for marking "me" in lists and keying per-player local notes.
export function playerId() {
  try { return localStorage.getItem(PLAYER_KEY) || ''; } catch { return ''; }
}
export function sessionToken() {
  try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; }
}
export function saveSession(token, userId) {
  try { localStorage.setItem(SESSION_KEY, token); localStorage.setItem(PLAYER_KEY, userId); } catch {}
}
export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

function key() {
  return (crypto.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/^[^A-Za-z0-9]/, 'k');
}

export class ApiError extends Error {
  constructor(code, status, where = null, detail = null) { super(code); this.code = code; this.status = status; this.where = where; this.detail = detail; }
}

// The bet scale this build was made for (lib/economy-upgrade.mjs). A page left open across a
// rescale would keep offering the old chips and every bet would bounce off the table limits, so
// it reloads once to pick up the new build.
export const ECONOMY = 3;
function checkEconomy(server) {
  if (!server || server === ECONOMY) return;
  const mark = `vegas:reloaded-for-economy:${server}`;
  try { if (sessionStorage.getItem(mark)) return; sessionStorage.setItem(mark, '1'); } catch { return; }
  location.reload();
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = sessionToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-idempotency-key'] = key(); }
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  const data = await res.json().catch(() => ({}));
  checkEconomy(data.economy ?? data.state?.economy);
  if (!res.ok) {
    // A missing or expired session sends the player back to the sign-in screen.
    if (data.error === 'AUTH_REQUIRED') { clearSession(); dispatchEvent(new CustomEvent('vegas:signed-out')); }
    throw new ApiError(data.error || 'BAD_REQUEST', res.status, data.where || null, data.detail || null);
  }
  return data;
}

export const api = {
  authOptions: () => request('/api/auth/options'),
  signup: (username, password, claimId) => request('/api/auth/signup', { method: 'POST', body: { username, password, claimId } }),
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  adminAdjust: (userId, amount, note) => request('/api/admin/adjust', { method: 'POST', body: { userId, amount, note } }),
  state: () => request('/api/state'),
  news: since => request(`/api/news?since=${encodeURIComponent(since)}`),
  pushKey: () => request('/api/push/key'),
  pushSubscribe: subscription => request('/api/push/subscribe', { method: 'POST', body: { subscription } }),
  pushUnsubscribe: endpoint => request('/api/push/unsubscribe', { method: 'POST', body: { endpoint } }),
  pushTest: () => request('/api/push/test', { method: 'POST' }),
  recharge: () => request('/api/recharge/auto', { method: 'POST' }),
  dailyClaim: () => request('/api/daily/claim', { method: 'POST' }),
  missionClaim: missionId => request('/api/missions/claim', { method: 'POST', body: { missionId } }),
  challenge: (opponentId, metric) => request('/api/social/challenges', { method: 'POST', body: { opponentId, metric } }),
  challengeAccept: id => request(`/api/social/challenges/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  challengeCancel: id => request(`/api/social/challenges/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  supportClaim: kind => request('/api/support/claim', { method: 'POST', body: { kind } }),
  achievementClaim: id => request('/api/achievements/claim', { method: 'POST', body: { id } }),
  borrow: (lender, amount, days) => request('/api/bank/borrow', { method: 'POST', body: { lender, amount, days } }),
  repay: (loanId, amount) => request('/api/bank/repay', { method: 'POST', body: { loanId, amount } }),
  bankruptcy: () => request('/api/bank/bankruptcy', { method: 'POST' }),
  rescue: pick => request('/api/rescue', { method: 'POST', body: { pick } }),
  blackjackOpen: () => request('/api/blackjack/v2/open'),
  // stakes: one amount per betting box in play, left to right.
  // sides: optional { pairs, trips }, the Perfect Pairs and 21+3 stake per box.
  blackjackStart: (stakes, floor, sides = {}) => request('/api/blackjack/v2/start', { method: 'POST', body: { stakes, floor, ...sides } }),
  blackjackAction: (roundId, action, handIndex) => request('/api/blackjack/v2/action', { method: 'POST', body: { roundId, action, handIndex } }),
  // sideBets: { PLAYER_PAIR?: stake, BANKER_PAIR?: stake } riding alongside the main bet.
  baccarat: (stake, floor, betType, sideBets) => request('/api/baccarat/play', { method: 'POST', body: { stake, floor, betType, sideBets } }),
  // bets: [{ betType, target?, stake }], one per spot on the layout.
  rouletteSpin: (bets, floor) => request('/api/roulette/spin', { method: 'POST', body: { bets, floor } }),
  roulette: (stake, floor, betType, target) => request('/api/roulette/play', { method: 'POST', body: { stake, floor, betType, target } }),
  sicbo: (stake, floor, betType, target) => request('/api/sicbo/play', { method: 'POST', body: { stake, floor, betType, target } }),
  slots: (stake, floor) => request('/api/slots/spin', { method: 'POST', body: { stake, floor } }),
  matgoOpen: () => request('/api/matgo/open'),
  matgoStart: (stake, floor, double = false) => request('/api/matgo/start', { method: 'POST', body: { stake, floor, double } }),
  matgoAction: (roundId, move) => request('/api/matgo/action', { method: 'POST', body: { roundId, ...move } }),
  gostopOpen: () => request('/api/gostop/open'),
  gostopStart: (stake, floor, double = false) => request('/api/gostop/start', { method: 'POST', body: { stake, floor, double } }),
  gostopAction: (roundId, move) => request('/api/gostop/action', { method: 'POST', body: { roundId, ...move } }),
  seotdaOpen: () => request('/api/seotda/open'),
  seotdaStart: (stake, floor, players) => request('/api/seotda/start', { method: 'POST', body: { stake, floor, players } }),
  seotdaAction: (roundId, action) => request('/api/seotda/action', { method: 'POST', body: { roundId, action } }),
  holdemOpen: () => request('/api/holdem/open'),
  holdemSit: (buyIn, floor, opponents) => request('/api/holdem/sit', { method: 'POST', body: { buyIn, floor, opponents } }),
  holdemAction: (sessionId, handNo, seq, action, amount) => request('/api/holdem/action', { method: 'POST', body: { sessionId, handNo, seq, action, amount } }),
  holdemNext: (sessionId, handNo) => request('/api/holdem/next', { method: 'POST', body: { sessionId, handNo } }),
  holdemLeave: sessionId => request('/api/holdem/leave', { method: 'POST', body: { sessionId } }),
  // Friends' rooms. cursor { hand, from } asks for the events after what this screen has played.
  holdemRooms: () => request('/api/holdem/rooms'),
  holdemRoom: (code, cursor) => request(`/api/holdem/room?code=${encodeURIComponent(code)}${cursor ? `&hand=${cursor.hand}&from=${cursor.from}` : ''}`),
  holdemRoomCreate: (buyIn, floor, size) => request('/api/holdem/rooms', { method: 'POST', body: { buyIn, floor, size } }),
  holdemRoomJoin: code => request('/api/holdem/rooms/join', { method: 'POST', body: { code } }),
  holdemRoomStart: (code, cursor) => request('/api/holdem/rooms/start', { method: 'POST', body: { code, cursor } }),
  holdemRoomAction: (code, handNo, seq, action, amount, cursor) => request('/api/holdem/rooms/action', { method: 'POST', body: { code, handNo, seq, action, amount, cursor } }),
  holdemRoomLeave: code => request('/api/holdem/rooms/leave', { method: 'POST', body: { code } }),
  holdemRoomShow: (code, cursor) => request('/api/holdem/rooms/show', { method: 'POST', body: { code, cursor } }),
  // Friends' rooms for 섯다, 고스톱 and 맞고: the same shape, one route set for all three.
  rooms: game => request(`/api/rooms${game ? `?game=${game}` : ''}`),
  room: (code, cursor) => request(`/api/room?code=${encodeURIComponent(code)}${cursor ? `&hand=${cursor.hand}&from=${cursor.from}` : ''}`),
  roomCreate: (game, stake, floor, size) => request('/api/rooms', { method: 'POST', body: { game, stake, floor, size } }),
  roomJoin: code => request('/api/rooms/join', { method: 'POST', body: { code } }),
  roomStart: (code, cursor) => request('/api/rooms/start', { method: 'POST', body: { code, cursor } }),
  roomAction: (code, handNo, seq, move, cursor) => request('/api/rooms/action', { method: 'POST', body: { code, handNo, seq, ...move, cursor } }),
  roomLeave: code => request('/api/rooms/leave', { method: 'POST', body: { code } })
};

const MESSAGES = {
  AUTH_REQUIRED: '다시 로그인해 주세요.',
  BAD_CREDENTIALS: '이름이나 비밀번호가 맞지 않아요.',
  ACCOUNT_LOCKED: '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요.',
  USERNAME_TAKEN: '이미 쓰고 있는 이름이에요. 다른 이름을 골라 주세요.',
  INVALID_USERNAME: '이름은 한글·영문·숫자 2~12자로 정해 주세요.',
  INVALID_PASSWORD: '비밀번호는 6자 이상으로 정해 주세요.',
  PROFILE_NOT_CLAIMABLE: '이미 다른 계정이 이어받은 기록이에요.',
  INVALID_AMOUNT: '금액을 다시 확인해 주세요.',
  FORBIDDEN: '운영자만 할 수 있어요.',
  SIGNUPS_CLOSED: '지금은 새 계정을 만들 수 없어요.',
  NETWORK: '서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.',
  INSUFFICIENT_BANKROLL: '칩이 부족해요. 베팅을 줄이거나 충전해 주세요.',
  FLOOR_LOCKED: '아직 잠긴 층이에요. 순자산(보유 칩 − 빚)을 늘리면 열려요.',
  FLOOR_OUTGROWN: '자산이 많아져서 이 층은 졸업했어요. 위층 테이블로 가 주세요.',
  LOAN_REFUSED: '지금은 이 곳에서 빌릴 수 없어요.',
  LOAN_OVER_LIMIT: '대출 한도를 넘었어요.',
  INVALID_TERM: '상환 기한을 골라 주세요.',
  LOAN_NOT_FOUND: '이미 끝난 대출이에요.',
  REPAY_OVER_BALANCE: '남은 빚보다 많이 갚을 수는 없어요.',
  BANKRUPTCY_NOT_AVAILABLE: '지금은 파산 신청을 할 수 없어요.',
  SUPPORT_ALREADY_CLAIMED: '이미 받았어요. 다음 지급일에 다시 와 주세요.',
  WELFARE_NOT_QUALIFIED: '순자산이 1천원 미만일 때만 받을 수 있어요.',
  ACHIEVEMENT_NOT_DONE: '아직 달성하지 않은 업적이에요.',
  ACHIEVEMENT_ALREADY_CLAIMED: '이미 받은 업적 보상이에요.',
  BET_OUTSIDE_TABLE_LIMIT: '이 테이블의 베팅 한도를 벗어났어요.',
  STAKE_TIER_NOT_ALLOWED: '이 테이블에서 쓸 수 없는 베팅 금액이에요.',
  OPEN_BLACKJACK_ROUND: '진행 중인 블랙잭 판이 있어요. 이어서 플레이해 주세요.',
  ROUND_NOT_FOUND: '이 판을 찾을 수 없어요. 새 판을 시작해 주세요.',
  HAND_NOT_ACTIONABLE: '지금은 이 핸드에 행동할 수 없어요.',
  DOUBLE_NOT_ALLOWED: '지금은 더블다운할 수 없어요.',
  SPLIT_NOT_ALLOWED: '같은 카드 두 장일 때만 스플릿할 수 있어요.',
  HAND_LIMIT_REACHED: '더 이상 스플릿할 수 없어요.',
  INVALID_SPOTS: '베팅 박스는 3개까지 쓸 수 있어요.',
  INSURANCE_NOT_OFFERED: '지금은 인슈어런스를 걸 수 없어요.',
  INSURANCE_DECISION_REQUIRED: '먼저 인슈어런스를 걸지 정해 주세요.',
  RECHARGE_NOT_AVAILABLE: '지금은 충전할 수 없어요.',
  OPEN_MATGO_ROUND: '진행 중인 맞고 판이 있어요. 이어서 플레이해 주세요.',
  OPEN_GOSTOP_ROUND: '진행 중인 고스톱 판이 있어요. 이어서 플레이해 주세요.',
  OPEN_SEOTDA_ROUND: '진행 중인 섯다 판이 있어요. 이어서 플레이해 주세요.',
  INVALID_PLAYERS: '섯다 인원은 2명에서 5명까지예요.',
  NOT_YOUR_TURN: '지금은 상대 차례예요.',
  TARGET_REQUIRED: '바닥에서 가져올 패를 골라 주세요.',
  ROUND_NOT_ACTIONABLE: '이미 끝난 판이에요.',
  OPEN_HOLDEM_SESSION: '이미 앉아 있는 홀덤 테이블이 있어요.',
  STALE_ACTION: '테이블 상황이 바뀌었어요. 다시 맞췄어요.',
  INVALID_RAISE: '레이즈 금액을 다시 골라 주세요.',
  CANNOT_CHECK: '지금은 체크할 수 없어요.',
  SESSION_CLOSED: '이미 끝난 테이블이에요.',
  ROOM_NOT_FOUND: '그 코드의 방을 찾지 못했어요. 코드를 다시 확인해 주세요.',
  ROOM_FULL: '방이 꽉 찼어요. 다른 방을 골라 주세요.',
  ALREADY_IN_ROOM: '이미 다른 방에 앉아 있어요.',
  NOT_IN_ROOM: '이 방에서 이미 일어났어요.',
  NOT_HOST: '딜은 방장이 시작해요.',
  OPEN_SOLO_ROUND: '혼자 하던 판을 먼저 끝내 주세요.',
  HAND_IN_PROGRESS: '이미 게임이 시작됐어요.',
  DAILY_ALREADY_CLAIMED: '오늘 일급은 이미 받았어요.',
  MISSION_NOT_DONE: '아직 미션을 끝내지 않았어요.',
  MISSION_ALREADY_CLAIMED: '이미 받은 보상이에요.',
  RESCUE_NOT_AVAILABLE: '지금은 럭키 카드를 뽑을 수 없어요.',
  CHALLENGE_ALREADY_OPEN: '이 친구와 같은 대결이 이미 진행 중이에요.',
  CHALLENGE_NOT_PENDING: '이미 답한 대결 신청이에요.',
  CHALLENGE_NOT_OPEN: '이미 끝난 대결이에요.',
  CHALLENGE_NOT_FOUND: '대결을 찾을 수 없어요.'
};

export function errorMessage(err) {
  if (err?.detail) return `${err.detail}.`;
  return MESSAGES[err?.code] || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}
