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

// One random id per phone or browser, made once. The server only uses it to refuse an invite
// reward when the friend played on the inviter's own device (lib/referral.mjs).
const DEVICE_KEY = 'vegas:device';
let deviceCache = '';
export function deviceId() {
  if (deviceCache) return deviceCache;
  try {
    deviceCache = localStorage.getItem(DEVICE_KEY) || '';
    if (!deviceCache) { deviceCache = (crypto.randomUUID?.() || `d${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/[^A-Za-z0-9-]/g, ''); localStorage.setItem(DEVICE_KEY, deviceCache); }
  } catch { deviceCache ||= `d${Date.now()}${Math.random().toString(16).slice(2)}`; }
  return deviceCache;
}

// A fresh idempotency key. Instant rounds keep theirs across a retry (Table.roundKey), so a round
// whose answer was lost on the way back is replayed by the server, not played twice.
export function newKey() {
  return (crypto.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/^[^A-Za-z0-9]/, 'k');
}

// The connection banner (notice.js) listens: a request that never reached the server, and the
// first one that does again.
let offline = false;
function reportNetwork(ok) {
  if (ok === !offline) return;
  offline = !ok;
  dispatchEvent(new CustomEvent('vegas:network', { detail: { ok } }));
}

export class ApiError extends Error {
  constructor(code, status, where = null, detail = null) { super(code); this.code = code; this.status = status; this.where = where; this.detail = detail; }
}

// The bet scale this build was made for (lib/economy-upgrade.mjs). A page left open across a
// rescale would keep offering the old chips and every bet would bounce off the table limits, so
// it reloads once to pick up the new build. Keep it equal to ECONOMY_VERSION: a build that lags
// reloads every new tab on its first answer, which threw away the first-visit pay sheet.
export const ECONOMY = 4;
function checkEconomy(server) {
  if (!server || server === ECONOMY) return;
  const mark = `vegas:reloaded-for-economy:${server}`;
  try { if (sessionStorage.getItem(mark)) return; sessionStorage.setItem(mark, '1'); } catch { return; }
  location.reload();
}

async function request(path, { method = 'GET', body, key = null } = {}) {
  const headers = {};
  const token = sessionToken();
  if (token) headers.authorization = `Bearer ${token}`;
  headers['x-device'] = deviceId();
  if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-idempotency-key'] = key || newKey(); }
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    reportNetwork(false);
    throw new ApiError('NETWORK', 0);
  }
  reportNetwork(true);
  const data = await res.json().catch(() => ({}));
  checkEconomy(data.economy ?? data.state?.economy);
  if (!res.ok) {
    // A missing or expired session sends the player back to the sign-in screen.
    if (data.error === 'AUTH_REQUIRED') { clearSession(); dispatchEvent(new CustomEvent('vegas:signed-out')); }
    throw new ApiError(data.error || 'BAD_REQUEST', res.status, data.where || null, data.detail || null);
  }
  // Anyone who keeps an eye on the player's state between screens (the 족보 도감, js/hand-book.js).
  const st = data.state?.user ? data.state : data.user && data.handBook ? data : null;
  if (st) dispatchEvent(new CustomEvent('vegas:state', { detail: st }));
  return data;
}

export const api = {
  authOptions: () => request('/api/auth/options'),
  signup: (username, password, claimId, ref) => request('/api/auth/signup', { method: 'POST', body: { username, password, claimId, ref } }),
  // 가입 없이 바로 플레이, and later the guest's name and password (the chips stay).
  guest: ref => request('/api/auth/guest', { method: 'POST', body: { terms: true, ref } }),
  nameGuest: (username, password, ref) => request('/api/auth/name', { method: 'POST', body: { username, password, ref } }),
  inviteInfo: ref => request(`/api/invite/info?r=${encodeURIComponent(ref)}`),
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  changePassword: (current, password) => request('/api/auth/password', { method: 'POST', body: { current, password } }),
  makeRecoveryCode: () => request('/api/auth/recovery', { method: 'POST' }),
  resetPassword: (username, code, password) => request('/api/auth/reset', { method: 'POST', body: { username, code, password } }),
  adminResetPassword: userId => request('/api/admin/password', { method: 'POST', body: { userId } }),
  adminAdjust: (userId, amount, note) => request('/api/admin/adjust', { method: 'POST', body: { userId, amount, note } }),
  adminErrors: () => request('/api/admin/errors'),
  adminErrorsClear: () => request('/api/admin/errors/clear', { method: 'POST' }),
  adminUsage: () => request('/api/admin/usage'),
  state: () => request('/api/state'),
  feedReact: (id, kind) => request('/api/feed/react', { method: 'POST', body: { id, kind } }),
  news: since => request(`/api/news?since=${encodeURIComponent(since)}`),
  friends: () => request('/api/friends'),
  friendAdd: nickname => request('/api/friends/add', { method: 'POST', body: { nickname } }),
  friendRemove: id => request('/api/friends/remove', { method: 'POST', body: { id } }),
  friendChallenge: (friendId, game, tier) => request('/api/friends/challenge', { method: 'POST', body: { friendId, game, tier } }),
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
  // 상점: itemId from the catalog in lib/shop.mjs; equip with itemId null puts the house look back.
  shopBuy: itemId => request('/api/shop/buy', { method: 'POST', body: { itemId } }),
  shopEquip: (slot, itemId) => request('/api/shop/equip', { method: 'POST', body: { slot, itemId } }),
  rescue: pick => request('/api/rescue', { method: 'POST', body: { pick } }),
  // 오늘의 한 판 (lib/daily-blackjack.mjs): step is how many commands this page has seen.
  daily: () => request('/api/dailybj'),
  dailyPlay: (move, step) => request('/api/dailybj/play', { method: 'POST', body: { move, step } }),
  blackjackOpen: () => request('/api/blackjack/v2/open'),
  // stakes: one amount per betting box in play, left to right.
  // sides: optional { pairs, trips }, the Perfect Pairs and 21+3 stake per box.
  blackjackStart: (stakes, floor, sides = {}) => request('/api/blackjack/v2/start', { method: 'POST', body: { stakes, floor, ...sides } }),
  blackjackAction: (roundId, action, handIndex) => request('/api/blackjack/v2/action', { method: 'POST', body: { roundId, action, handIndex } }),
  // sideBets: { PLAYER_PAIR?: stake, BANKER_PAIR?: stake } riding alongside the main bet.
  double: (roundId, pick) => request('/api/double', { method: 'POST', body: { roundId, pick } }),
  // Instant rounds take an optional idempotency `key`: a retry of the same bet passes the same one.
  baccarat: (stake, floor, betType, sideBets, event, key) => request('/api/baccarat/play', { method: 'POST', key, body: { stake, floor, betType, sideBets, ...(event ? { event } : {}) } }),
  // bets: [{ betType, target?, stake }], one per spot on the layout.
  rouletteSpin: (bets, floor, lightning = false, event = null, key) => request('/api/roulette/spin', { method: 'POST', key, body: { bets, floor, ...(lightning ? { lightning: true } : {}), ...(event ? { event } : {}) } }),
  roulette: (stake, floor, betType, target) => request('/api/roulette/play', { method: 'POST', body: { stake, floor, betType, target } }),
  sicboRoll: (bets, floor, event = null, key) => request('/api/sicbo/roll', { method: 'POST', key, body: { bets, floor, ...(event ? { event } : {}) } }),
  sicbo: (stake, floor, betType, target, event = null, key) => request('/api/sicbo/play', { method: 'POST', key, body: { stake, floor, betType, target, ...(event ? { event } : {}) } }),
  slots: (stake, floor, lightning = false, key, lines = 1) => request('/api/slots/spin', { method: 'POST', key, body: { stake, floor, ...(lightning ? { lightning: true } : {}), ...(lines > 1 ? { lines } : {}) } }),
  horsesCard: () => request('/api/horses/card'),
  horsesRace: (stake, floor, cardId, betType, pick) => request('/api/horses/race', { method: 'POST', body: { stake, floor, cardId, betType, pick } }),
  matgoOpen: () => request('/api/matgo/open'),
  matgoStart: (stake, floor, double = false) => request('/api/matgo/start', { method: 'POST', body: { stake, floor, double } }),
  matgoAction: (roundId, move) => request('/api/matgo/action', { method: 'POST', body: { roundId, ...move } }),
  gostopOpen: (event = null) => request(`/api/gostop/open${event ? `?event=${event}` : ''}`),
  gostopStart: (stake, floor, double = false, event = null) => request('/api/gostop/start', { method: 'POST', body: { stake, floor, double, ...(event ? { event } : {}) } }),
  gostopAction: (roundId, move) => request('/api/gostop/action', { method: 'POST', body: { roundId, ...move } }),
  seotdaOpen: () => request('/api/seotda/open'),
  seotdaStart: (stake, floor, players) => request('/api/seotda/start', { method: 'POST', body: { stake, floor, players } }),
  seotdaAction: (roundId, action) => request('/api/seotda/action', { method: 'POST', body: { roundId, action } }),
  holdemOpen: () => request('/api/holdem/open'),
  holdemSit: (buyIn, floor, opponents, royale = false, event = null) => request('/api/holdem/sit', { method: 'POST', body: { buyIn, floor, opponents, royale, ...(event ? { event } : {}) } }),
  holdemRebuy: sessionId => request('/api/holdem/rebuy', { method: 'POST', body: { sessionId } }),
  holdemAction: (sessionId, handNo, seq, action, amount) => request('/api/holdem/action', { method: 'POST', body: { sessionId, handNo, seq, action, amount } }),
  holdemNext: (sessionId, handNo) => request('/api/holdem/next', { method: 'POST', body: { sessionId, handNo } }),
  holdemLeave: sessionId => request('/api/holdem/leave', { method: 'POST', body: { sessionId } }),
  sevenOpen: () => request('/api/sevenpoker/open'),
  sevenSit: (buyIn, floor, opponents) => request('/api/sevenpoker/sit', { method: 'POST', body: { buyIn, floor, opponents } }),
  sevenAction: (sessionId, handNo, seq, action, index) => request('/api/sevenpoker/action', { method: 'POST', body: { sessionId, handNo, seq, action, ...(index === undefined ? {} : { index }) } }),
  sevenNext: (sessionId, handNo) => request('/api/sevenpoker/next', { method: 'POST', body: { sessionId, handNo } }),
  sevenLeave: sessionId => request('/api/sevenpoker/leave', { method: 'POST', body: { sessionId } }),
  // 매일 밤 9시 홀덤 토너먼트 (lib/nightly-tourney.mjs).
  nightly: () => request('/api/nightly'),
  nightlyRegister: () => request('/api/nightly/register', { method: 'POST', body: {} }),
  nightlyUnregister: () => request('/api/nightly/unregister', { method: 'POST', body: {} }),
  // Friends' rooms. cursor { hand, from } asks for the events after what this screen has played.
  holdemRooms: (game = 'holdem') => request(game === 'holdem' ? '/api/holdem/rooms' : `/api/holdem/rooms?game=${encodeURIComponent(game)}`),
  holdemRoom: (code, cursor, watch) => request(`/api/holdem/room?code=${encodeURIComponent(code)}${cursor ? `&hand=${cursor.hand}&from=${cursor.from}` : ''}${watch ? `&watch=${encodeURIComponent(watch)}` : ''}`),
  holdemRoomCreate: (buyIn, floor, size, mode = 'cash', bots = true, game = 'holdem') => request('/api/holdem/rooms', { method: 'POST', body: { buyIn, floor, size, mode, bots, game } }),
  holdemRoomJoin: code => request('/api/holdem/rooms/join', { method: 'POST', body: { code } }),
  holdemRoomStart: (code, cursor) => request('/api/holdem/rooms/start', { method: 'POST', body: { code, cursor } }),
  holdemRoomAction: (code, handNo, seq, action, amount, cursor) => request('/api/holdem/rooms/action', { method: 'POST', body: { code, handNo, seq, action, amount, cursor } }),
  holdemRoomLeave: code => request('/api/holdem/rooms/leave', { method: 'POST', body: { code } }),
  holdemRoomShow: (code, cursor) => request('/api/holdem/rooms/show', { method: 'POST', body: { code, cursor } }),
  holdemRoomChat: (code, line, cursor) => request('/api/holdem/rooms/chat', { method: 'POST', body: { code, ...line, cursor } }),
  holdemRoomBack: (code, cursor) => request('/api/holdem/rooms/back', { method: 'POST', body: { code, cursor } }),
  // Friends' rooms for 섯다, 고스톱 and 맞고: the same shape, one route set for all three.
  rooms: game => request(`/api/rooms${game ? `?game=${game}` : ''}`),
  room: (code, cursor, watch) => request(`/api/room?code=${encodeURIComponent(code)}${cursor ? `&hand=${cursor.hand}&from=${cursor.from}` : ''}${watch ? `&watch=${encodeURIComponent(watch)}` : ''}`),
  roomCreate: (game, stake, floor, size) => request('/api/rooms', { method: 'POST', body: { game, stake, floor, size } }),
  roomJoin: code => request('/api/rooms/join', { method: 'POST', body: { code } }),
  roomStart: (code, cursor) => request('/api/rooms/start', { method: 'POST', body: { code, cursor } }),
  roomAction: (code, handNo, seq, move, cursor) => request('/api/rooms/action', { method: 'POST', body: { code, handNo, seq, ...move, cursor } }),
  roomLeave: code => request('/api/rooms/leave', { method: 'POST', body: { code } }),
  roomChat: (code, line, cursor) => request('/api/rooms/chat', { method: 'POST', body: { code, ...line, cursor } })
};

const MESSAGES = {
  AUTH_REQUIRED: '다시 로그인해 주세요.',
  CHAT_EMPTY: '보낼 말을 적어 주세요.',
  CHAT_TOO_FAST: '조금 천천히 보내 주세요.',
  BAD_CREDENTIALS: '이름이나 비밀번호가 맞지 않아요.',
  ACCOUNT_LOCKED: '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요.',
  BAD_RECOVERY: '이름이나 복구 코드가 맞지 않아요. 복구 코드가 없으면 운영자에게 임시 비밀번호를 받아 주세요.',
  NO_ACCOUNT: '이 플레이어는 로그인 계정이 없어요.',
  USERNAME_TAKEN: '이미 쓰고 있는 이름이에요. 다른 이름을 골라 주세요.',
  GUESTS_FULL: '지금은 게스트 자리가 꽉 찼어요. 이름과 비밀번호로 계정을 만들어 주세요.',
  GUEST_LIMIT: '이 기기에서 게스트를 너무 많이 만들었어요. 이름과 비밀번호로 계정을 만들어 주세요.',
  NOT_A_GUEST: '이미 이름이 있는 계정이에요.',
  TERMS_REQUIRED: '만 19세 이상인지, 이용약관에 동의하는지 확인해 주세요.',
  INVALID_USERNAME: '이름은 한글·영문·숫자 2~12자로 정해 주세요.',
  INVALID_PASSWORD: '비밀번호는 6자 이상으로 정해 주세요.',
  PROFILE_NOT_CLAIMABLE: '이미 다른 계정이 이어받은 기록이에요.',
  INVALID_AMOUNT: '금액을 다시 확인해 주세요.',
  AMOUNT_NOT_IN_UNITS: '금액은 100만원 단위로만 돼요.',
  FORBIDDEN: '운영자만 할 수 있어요.',
  SIGNUPS_CLOSED: '지금은 새 계정을 만들 수 없어요.',
  NETWORK: '서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.',
  RACE_CARD_STALE: '출전표가 바뀌었어요. 새 배당을 보고 다시 걸어 주세요.',
  INSUFFICIENT_BANKROLL: '칩이 부족해요. 베팅을 줄이거나 충전해 주세요.',
  FLOOR_LOCKED: '아직 잠긴 층이에요. 순자산(보유 칩 − 빚)을 늘리면 열려요.',
  FLOOR_OUTGROWN: '자산이 많아져서 이 층은 졸업했어요. 위층 테이블로 가 주세요.',
  FLOOR_PASS_REQUIRED: '이 층에 앉으려면 이번 달 입장권이 필요해요. 상점 꾸미기에서 이 층 꾸미기를 사거나 갱신해 주세요.',
  NEW_ACCOUNT_ROOM_LIMIT: '가입 7일이 안 된 계정은 친구방을 High Limit 층까지만 쓸 수 있어요.',
  EVENT_ENTRY_REQUIRED: '이벤트 테이블은 칩을 100억 이상 가진 사람만 앉을 수 있어요.',
  EVENT_FLOOR_ONLY: '이벤트는 Penthouse 테이블에서만 열려요.',
  EVENT_CLOSED: '이번 주에 열린 이벤트가 아니에요.',
  LOAN_REFUSED: '지금은 이 곳에서 빌릴 수 없어요.',
  LOAN_OVER_LIMIT: '대출 한도를 넘었어요.',
  INVALID_TERM: '상환 기한을 골라 주세요.',
  LOAN_NOT_FOUND: '이미 끝난 대출이에요.',
  REPAY_OVER_BALANCE: '남은 빚보다 많이 갚을 수는 없어요.',
  BANKRUPTCY_NOT_AVAILABLE: '지금은 파산 신청을 할 수 없어요.',
  SUPPORT_ALREADY_CLAIMED: '이미 받았어요. 다음 지급일에 다시 와 주세요.',
  WELFARE_NOT_QUALIFIED: '칩이 100만원 미만일 때만 받을 수 있어요.',
  ACHIEVEMENT_NOT_DONE: '아직 달성하지 않은 업적이에요.',
  ACHIEVEMENT_ALREADY_CLAIMED: '이미 받은 업적 보상이에요.',
  BET_OUTSIDE_TABLE_LIMIT: '이 테이블의 베팅 한도를 벗어났어요.',
  BET_NOT_IN_UNITS: '베팅은 100만원 단위로만 할 수 있어요.',
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
  OPEN_HOLDEM_SESSION: '이미 앉아 있는 포커 테이블(홀덤·7포커)이 있어요.',
  OPEN_SEVENPOKER_SESSION: '이미 앉아 있는 7포커 테이블이 있어요.',
  CHOOSE_FIRST: '먼저 오픈할 카드를 골라 주세요.',
  ALREADY_CHOSEN: '오픈할 카드는 이미 골랐어요.',
  STALE_ACTION: '테이블 상황이 바뀌었어요. 다시 맞췄어요.',
  INVALID_RAISE: '레이즈 금액을 다시 골라 주세요.',
  CANNOT_CHECK: '지금은 체크할 수 없어요.',
  SESSION_CLOSED: '이미 끝난 테이블이에요.',
  ROOM_NOT_FOUND: '그 코드의 방을 찾지 못했어요. 코드를 다시 확인해 주세요.',
  ROOM_FULL: '방이 꽉 찼어요. 다른 방을 골라 주세요.',
  FRIEND_BUSY: '친구가 지금 다른 친구방에 앉아 있어요. 끝나면 다시 도전해 주세요.',
  CHALLENGE_ONLY: '도전받은 친구만 앉을 수 있는 자리예요.',
  CHALLENGE_DONE: '이미 끝난 도전이에요.',
  CHALLENGE_WAITING: '친구가 들어오면 바로 시작해요.',
  WATCH_GONE: '친구가 그 방에서 나갔어요.',
  WATCH_NOT_FRIEND: '그 친구가 나를 친구로 두어야 관전할 수 있어요.',
  WATCH_CONFLICT: '그 테이블엔 내 다른 친구도 앉아 있어서 관전할 수 없어요.',
  FRIEND_NOT_FOUND: '그 닉네임의 플레이어를 찾지 못했어요.',
  FRIEND_IS_ME: '나는 친구로 추가할 수 없어요.',
  FRIEND_LIST_FULL: '친구는 50명까지 추가할 수 있어요.',
  FRIEND_NAME_REQUIRED: '친구 닉네임을 넣어 주세요.',
  ALREADY_IN_ROOM: '이미 다른 방에 앉아 있어요.',
  NOT_IN_ROOM: '이 방에서 이미 일어났어요.',
  NOT_HOST: '딜은 방장이 시작해요.',
  TOURNEY_STARTED: '이미 시작한 토너먼트예요. 중간에는 들어갈 수 없어요.',
  NIGHTLY_CLOSED: '오늘 홀덤 토너먼트 등록이 마감됐어요. 내일 자정부터 다시 받아요.',
  NIGHTLY_FULL: '오늘 밤 토너먼트는 자리가 다 찼어요.',
  NOT_REGISTERED: '등록하지 않은 토너먼트예요.',
  NIGHTLY_TABLE: '매일 홀덤 토너먼트 테이블은 등록한 사람만 앉아요.',
  NOT_ENOUGH_PLAYERS: '토너먼트는 두 명 이상 앉아야 시작할 수 있어요.',
  OPEN_SOLO_ROUND: '혼자 하던 판을 먼저 끝내 주세요.',
  HAND_IN_PROGRESS: '이미 게임이 시작됐어요.',
  DAILY_ALREADY_CLAIMED: '오늘 일급은 이미 받았어요.',
  MISSION_NOT_DONE: '아직 미션을 끝내지 않았어요.',
  MISSION_ALREADY_CLAIMED: '이미 받은 보상이에요.',
  RESCUE_NOT_AVAILABLE: '지금은 럭키 카드를 뽑을 수 없어요.',
  CHALLENGE_ALREADY_OPEN: '이 친구와 같은 대결이 이미 진행 중이에요.',
  CHALLENGE_NOT_PENDING: '이미 답한 대결 신청이에요.',
  CHALLENGE_NOT_OPEN: '이미 끝난 대결이에요.',
  CHALLENGE_NOT_FOUND: '대결을 찾을 수 없어요.',
  ITEM_NOT_FOUND: '상점에 없는 물건이에요. 화면을 새로 고쳐 주세요.',
  ITEM_ALREADY_OWNED: '이미 가지고 있어요.',
  ITEM_NOT_OWNED: '가지고 있지 않은 물건이에요.',
  ITEM_NOT_FOR_SALE: '업적을 달성하면 무료로 열리는 스킨이에요.',
  ITEM_NOT_SELLABLE: '꾸미기는 되팔 수 없어요.',
  INVALID_SLOT: '장착할 수 없는 자리예요.',
  DAILY_ALREADY_PLAYED: '오늘의 한 판은 이미 쳤어요. 내일 자정에 새 판이 열려요.',
  DAILY_NOT_STARTED: '오늘의 한 판을 먼저 시작해 주세요.',
  DAILY_BAD_MOVE: '지금은 할 수 없는 선택이에요.',
  IDEMPOTENCY_CONFLICT: '같은 요청이 이미 처리 중이에요. 잠시 후 다시 시도해 주세요.'
};

export function errorMessage(err) {
  if (err?.detail) return `${err.detail}.`;
  return MESSAGES[err?.code] || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}
