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
  constructor(code, status) { super(code); this.code = code; this.status = status; }
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
  if (!res.ok) {
    // A missing or expired session sends the player back to the sign-in screen.
    if (data.error === 'AUTH_REQUIRED') { clearSession(); dispatchEvent(new CustomEvent('vegas:signed-out')); }
    throw new ApiError(data.error || 'BAD_REQUEST', res.status);
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
  recharge: () => request('/api/recharge/auto', { method: 'POST' }),
  dailyClaim: () => request('/api/daily/claim', { method: 'POST' }),
  missionClaim: missionId => request('/api/missions/claim', { method: 'POST', body: { missionId } }),
  challenge: (opponentId, metric) => request('/api/social/challenges', { method: 'POST', body: { opponentId, metric } }),
  challengeAccept: id => request(`/api/social/challenges/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  challengeCancel: id => request(`/api/social/challenges/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  rescue: pick => request('/api/rescue', { method: 'POST', body: { pick } }),
  blackjackOpen: () => request('/api/blackjack/v2/open'),
  // stakes: one amount per betting box in play, left to right.
  blackjackStart: (stakes, floor) => request('/api/blackjack/v2/start', { method: 'POST', body: { stakes, floor } }),
  blackjackAction: (roundId, action, handIndex) => request('/api/blackjack/v2/action', { method: 'POST', body: { roundId, action, handIndex } }),
  baccarat: (stake, floor, betType) => request('/api/baccarat/play', { method: 'POST', body: { stake, floor, betType } }),
  // bets: [{ betType, target?, stake }], one per spot on the layout.
  rouletteSpin: (bets, floor) => request('/api/roulette/spin', { method: 'POST', body: { bets, floor } }),
  roulette: (stake, floor, betType, target) => request('/api/roulette/play', { method: 'POST', body: { stake, floor, betType, target } }),
  sicbo: (stake, floor, betType, target) => request('/api/sicbo/play', { method: 'POST', body: { stake, floor, betType, target } }),
  slots: (stake, floor) => request('/api/slots/spin', { method: 'POST', body: { stake, floor } }),
  matgoOpen: () => request('/api/matgo/open'),
  matgoStart: (stake, floor) => request('/api/matgo/start', { method: 'POST', body: { stake, floor } }),
  matgoAction: (roundId, move) => request('/api/matgo/action', { method: 'POST', body: { roundId, ...move } }),
  seotdaOpen: () => request('/api/seotda/open'),
  seotdaStart: (stake, floor) => request('/api/seotda/start', { method: 'POST', body: { stake, floor } }),
  seotdaAction: (roundId, action) => request('/api/seotda/action', { method: 'POST', body: { roundId, action } }),
  holdemOpen: () => request('/api/holdem/open'),
  holdemSit: (buyIn, floor, opponents) => request('/api/holdem/sit', { method: 'POST', body: { buyIn, floor, opponents } }),
  holdemAction: (sessionId, handNo, seq, action, amount) => request('/api/holdem/action', { method: 'POST', body: { sessionId, handNo, seq, action, amount } }),
  holdemNext: (sessionId, handNo) => request('/api/holdem/next', { method: 'POST', body: { sessionId, handNo } }),
  holdemLeave: sessionId => request('/api/holdem/leave', { method: 'POST', body: { sessionId } })
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
  FLOOR_LOCKED: '아직 잠긴 층이에요. 플레이 수익으로 열 수 있어요.',
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
  OPEN_SEOTDA_ROUND: '진행 중인 섯다 판이 있어요. 이어서 플레이해 주세요.',
  NOT_YOUR_TURN: '지금은 상대 차례예요.',
  TARGET_REQUIRED: '바닥에서 가져올 패를 골라 주세요.',
  ROUND_NOT_ACTIONABLE: '이미 끝난 판이에요.',
  OPEN_HOLDEM_SESSION: '이미 앉아 있는 홀덤 테이블이 있어요.',
  STALE_ACTION: '테이블 상황이 바뀌었어요. 다시 맞췄어요.',
  INVALID_RAISE: '레이즈 금액을 다시 골라 주세요.',
  CANNOT_CHECK: '지금은 체크할 수 없어요.',
  SESSION_CLOSED: '이미 끝난 테이블이에요.',
  DAILY_ALREADY_CLAIMED: '오늘 출석 보너스는 이미 받았어요.',
  MISSION_NOT_DONE: '아직 미션을 끝내지 않았어요.',
  MISSION_ALREADY_CLAIMED: '이미 받은 보상이에요.',
  RESCUE_NOT_AVAILABLE: '지금은 럭키 카드를 뽑을 수 없어요.',
  CHALLENGE_ALREADY_OPEN: '이 친구와 같은 대결이 이미 진행 중이에요.',
  CHALLENGE_NOT_PENDING: '이미 답한 대결 신청이에요.',
  CHALLENGE_NOT_OPEN: '이미 끝난 대결이에요.',
  CHALLENGE_NOT_FOUND: '대결을 찾을 수 없어요.'
};

export function errorMessage(err) {
  return MESSAGES[err?.code] || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}
