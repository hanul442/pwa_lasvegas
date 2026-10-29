// Achievements: one-time goals that stay with a player for good. Each reads what the player has
// already done (stats, records, floors, the bank) and pays once when claimed, counted in the
// player's base (rewardBase) as it was when the goal was reached: lib/economy.mjs calls
// noteAchievements after every ledger row, so holding a reward until a higher floor pays nothing more.
import { FLOORS } from './constants.mjs';
import { addLedger, ledgerWatchers } from './economy.mjs';
import { gradeOf } from './bank.mjs';
import { pushFeed } from './engagement.mjs';
import { rewardBase } from './state.mjs';
import { HAND_BOOK, HAND_BOOK_PAGES, handBookCount, pageCount, pageSize } from './hand-book.mjs';

const GAMES = [['Blackjack', '블랙잭'], ['Baccarat', '바카라'], ['Roulette', '룰렛'], ['Sic Bo', '식보'], ['Matgo', '맞고'], ['Gostop', '고스톱'], ['Seotda', '섯다'], ["Hold'em", '홀덤'], ['Slots', '슬롯']];

const sum = (user, key) => Object.values(user.stats || {}).reduce((t, s) => t + (s[key] || 0), 0);
const bank = user => user.bankStats || {};
const pay = user => user.payStats || {};

// group: how the list is grouped on screen. value(user) → progress toward target.
export const ACHIEVEMENTS = [
  { id: 'first-round', group: '플레이', label: '첫 판', desc: '아무 게임이나 한 판 하기', target: 1, pays: 5, value: u => sum(u, 'rounds') },
  { id: 'rounds-100', group: '플레이', label: '단골손님', desc: '100판 하기', target: 100, pays: 30, value: u => sum(u, 'rounds') },
  { id: 'rounds-1000', group: '플레이', label: '카지노에 사는 사람', desc: '1,000판 하기', target: 1000, pays: 150, value: u => sum(u, 'rounds') },
  { id: 'rounds-5000', group: '플레이', label: '전설의 죽돌이', desc: '5,000판 하기', target: 5000, pays: 500, value: u => sum(u, 'rounds') },
  { id: 'first-win', group: '플레이', label: '첫 승리', desc: '처음으로 이기기', target: 1, pays: 5, value: u => sum(u, 'wins') },
  { id: 'wins-50', group: '플레이', label: '이기는 맛', desc: '50번 이기기', target: 50, pays: 30, value: u => sum(u, 'wins') },
  { id: 'wins-500', group: '플레이', label: '승부사', desc: '500번 이기기', target: 500, pays: 200, value: u => sum(u, 'wins') },
  { id: 'streak-5', group: '플레이', label: '불붙었다', desc: '5연승', target: 5, pays: 30, value: u => u.streak?.best || 0 },
  { id: 'streak-10', group: '플레이', label: '신들린 손', desc: '10연승', target: 10, pays: 150, value: u => u.streak?.best || 0 },
  { id: 'mission-week', group: '플레이', label: '개근', desc: '7일 연속 오늘의 미션 다 끝내기 · 개근 명패', target: 7, pays: 30, value: u => u.missionStreak?.best || 0 },
  { id: 'mult-10', group: '플레이', label: '한 방', desc: '한 판에 건 돈의 10배 이상 따기', target: 10, pays: 40, value: u => u.records?.bestMultiple || 0 },
  { id: 'mult-35', group: '플레이', label: '스트레이트 업', desc: '한 판에 건 돈의 35배 이상 따기', target: 35, pays: 120, value: u => u.records?.bestMultiple || 0 },
  { id: 'all-games', group: '플레이', label: '올라운더', desc: '9가지 게임을 모두 해보기', target: GAMES.length, pays: 50, value: u => GAMES.filter(([g]) => u.stats?.[g]?.rounds > 0).length },
  ...GAMES.map(([game, ko]) => ({ id: `win-${game.toLowerCase().replace(/[^a-z]/g, '')}`, group: '게임', label: `${ko} 첫 승`, desc: `${ko}에서 처음 이기기`, target: 1, pays: 8, value: u => u.stats?.[game]?.wins || 0 })),
  ...FLOORS.slice(1).map((f, i) => ({ id: `floor-${f.slug}`, group: '층', label: `${f.name} 입성`, desc: `순자산으로 ${f.name} 층 열기`, target: 1, pays: 20 + i * 10, value: u => u.account.unlockedFloors.includes(f.slug) ? 1 : 0 })),
  { id: 'loan-first', group: '은행', label: '첫 대출', desc: '은행에서 처음 돈 빌리기', target: 1, pays: 3, value: u => bank(u).loans || 0 },
  { id: 'loan-shark', group: '은행', label: '뒷골목 거래', desc: '사채 써보기', target: 1, pays: 3, value: u => (bank(u).lenders || []).includes('shark') ? 1 : 0 },
  { id: 'repay-1', group: '은행', label: '약속은 지킨다', desc: '대출을 만기 전에 다 갚기', target: 1, pays: 10, value: u => bank(u).onTime || 0 },
  { id: 'repay-10', group: '은행', label: '우량 고객', desc: '대출을 만기 전에 10번 다 갚기', target: 10, pays: 60, value: u => bank(u).onTime || 0 },
  { id: 'grade-3', group: '은행', label: '1금융권 입성', desc: '신용 3등급 되기', target: 1, pays: 50, value: u => gradeOf(u.credit?.score ?? 500) <= 3 ? 1 : 0 },
  { id: 'grade-1', group: '은행', label: '신용 1등급', desc: '신용 1등급 되기', target: 1, pays: 150, value: u => gradeOf(u.credit?.score ?? 500) === 1 ? 1 : 0 },
  { id: 'bankrupt', group: '은행', label: '인생 2회차', desc: '파산 신청하고 다시 시작하기', target: 1, pays: 10, value: u => bank(u).bankruptcies || 0 },
  { id: 'pay-week', group: '출석', label: '첫 주급', desc: '7일 연속 출근해서 주급 받기', target: 1, pays: 20, value: u => pay(u).weeks || 0 },
  { id: 'pay-month', group: '출석', label: '첫 월급', desc: '28일 연속 출근해서 월급 받기', target: 1, pays: 100, value: u => pay(u).months || 0 },
  // 족보 도감 (lib/hand-book.mjs): half the book and the whole book each unlock a nameplate.
  { id: 'jokbo-first', group: '도감', label: '첫 족보', desc: '족보 도감에 처음으로 한 칸 채우기', target: 1, pays: 5, value: handBookCount },
  { id: 'jokbo-10', group: '도감', label: '족보 수집가', desc: '족보 10가지 모으기', target: 10, pays: 40, value: handBookCount },
  { id: 'jokbo-half', group: '도감', label: '족보 반권', desc: `족보 ${Math.ceil(HAND_BOOK.length / 2)}가지 모으기 · 족보 명패`, target: Math.ceil(HAND_BOOK.length / 2), pays: 200, value: handBookCount },
  { id: 'jokbo-all', group: '도감', label: '족보 완전정복', desc: `족보 ${HAND_BOOK.length}가지 전부 모으기 · 족보 마스터 명패`, target: HAND_BOOK.length, pays: 1000, value: handBookCount },
  ...HAND_BOOK_PAGES.map(p => ({ id: `jokbo-page-${p.id}`, group: '도감', label: `${p.name} 도감 완성`, desc: `${p.name} 족보 ${pageSize(p.id)}가지 모두 모으기`, target: pageSize(p.id), pays: 10 * pageSize(p.id), value: u => pageCount(u, p.id) })),
  { id: 'pay-days-100', group: '출석', label: '개근상', desc: '일급 100번 받기', target: 100, pays: 100, value: u => pay(u).days || 0 }
];

function claimedSet(user) { return Array.isArray(user.achievements) ? user.achievements : []; }

// The base each finished, unclaimed goal pays in, written the first time it is seen done.
export function noteAchievements(user) {
  if (!user?.account) return;
  const claimed = claimedSet(user);
  let bases = user.achievementBase;
  for (const a of ACHIEVEMENTS) {
    if (claimed.includes(a.id) || bases?.[a.id] != null || a.value(user) < a.target) continue;
    bases = user.achievementBase = { ...(bases || {}), [a.id]: rewardBase(user) };
  }
}
ledgerWatchers.push(noteAchievements);
const baseFor = (user, a) => user.achievementBase?.[a.id] ?? rewardBase(user);

export function achievementsView(user) {
  const claimed = claimedSet(user);
  return ACHIEVEMENTS.map(a => {
    const progress = Math.min(a.target, a.value(user));
    return { id: a.id, group: a.group, label: a.label, desc: a.desc, target: a.target, progress, reward: a.pays * baseFor(user, a), done: progress >= a.target, claimed: claimed.includes(a.id) };
  });
}

export function claimAchievement(state, user, achievementId) {
  const a = ACHIEVEMENTS.find(x => x.id === achievementId);
  if (!a) throw new Error('ACHIEVEMENT_NOT_FOUND');
  const claimed = claimedSet(user);
  if (claimed.includes(a.id)) throw new Error('ACHIEVEMENT_ALREADY_CLAIMED');
  if (a.value(user) < a.target) throw new Error('ACHIEVEMENT_NOT_DONE');
  const amount = a.pays * baseFor(user, a);
  user.achievements = [...claimed, a.id];
  if (user.achievementBase) delete user.achievementBase[a.id];
  addLedger(state, user, { type: 'ACHIEVEMENT', amount, referenceType: 'ACHIEVEMENT', referenceId: a.id, metadata: { achievement: a.id } });
  if (a.pays >= 100) pushFeed(state, { type: 'ACHIEVEMENT', actorId: user.id, text: a.label });
  return { amount, id: a.id, label: a.label };
}
