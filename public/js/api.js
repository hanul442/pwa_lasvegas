// Thin client for the server-authoritative game API.
import { API_BASE } from './config.js';

const PLAYER_KEY = 'vegas:player';

export function playerId() {
  try { return localStorage.getItem(PLAYER_KEY) || 'hanseo'; } catch { return 'hanseo'; }
}

function key() {
  return (crypto.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/^[^A-Za-z0-9]/, 'k');
}

export class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'x-player-id': playerId() };
  if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-idempotency-key'] = key(); }
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'BAD_REQUEST', res.status);
  return data;
}

export const api = {
  state: () => request('/api/state'),
  recharge: () => request('/api/recharge/auto', { method: 'POST' }),
  blackjackOpen: () => request('/api/blackjack/v2/open'),
  // stakes: one amount per betting box in play, left to right.
  blackjackStart: (stakes, floor) => request('/api/blackjack/v2/start', { method: 'POST', body: { stakes, floor } }),
  blackjackAction: (roundId, action, handIndex) => request('/api/blackjack/v2/action', { method: 'POST', body: { roundId, action, handIndex } }),
  baccarat: (stake, floor, betType) => request('/api/baccarat/play', { method: 'POST', body: { stake, floor, betType } }),
  roulette: (stake, floor, betType, target) => request('/api/roulette/play', { method: 'POST', body: { stake, floor, betType, target } }),
  sicbo: (stake, floor, betType, target) => request('/api/sicbo/play', { method: 'POST', body: { stake, floor, betType, target } }),
  holdemOpen: () => request('/api/holdem/open'),
  holdemSit: (buyIn, floor, opponents) => request('/api/holdem/sit', { method: 'POST', body: { buyIn, floor, opponents } }),
  holdemAction: (sessionId, handNo, seq, action, amount) => request('/api/holdem/action', { method: 'POST', body: { sessionId, handNo, seq, action, amount } }),
  holdemNext: (sessionId, handNo) => request('/api/holdem/next', { method: 'POST', body: { sessionId, handNo } }),
  holdemLeave: sessionId => request('/api/holdem/leave', { method: 'POST', body: { sessionId } })
};

const MESSAGES = {
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
  OPEN_HOLDEM_SESSION: '이미 앉아 있는 홀덤 테이블이 있어요.',
  STALE_ACTION: '테이블 상황이 바뀌었어요. 다시 맞췄어요.',
  INVALID_RAISE: '레이즈 금액을 다시 골라 주세요.',
  CANNOT_CHECK: '지금은 체크할 수 없어요.',
  SESSION_CLOSED: '이미 끝난 테이블이에요.'
};

export function errorMessage(err) {
  return MESSAGES[err?.code] || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}
