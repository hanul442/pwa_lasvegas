// 처음 온 사람의 첫날: until the first hand, home is just my chips, today's 손익 and one button
// that seats me at blackjack with the table minimum already on the felt. For the first few hands
// the app keeps quiet: no season sheet, no floor or tier moments, no news banners, no push ask.
import { el, wonCH } from './fx.js';

// Hands played across every game (lib/economy.mjs keeps per-game stats; the season reset leaves
// them alone, so an old player never looks new again).
export const handsPlayed = st => Object.values(st?.user?.stats || {}).reduce((sum, s) => sum + (Number(s?.rounds) || 0), 0);

// Never bet anything yet: the first-hand home.
export const isNewcomer = st => Boolean(st?.user) && !st.user.account?.totalWagered && handsPlayed(st) === 0;

// The first three hands play without popups.
export const QUIET_HANDS = 3;
export const isSettlingIn = st => Boolean(st?.user) && handsPlayed(st) < QUIET_HANDS;

// The card on top of home for the first few hands. `onPlay(button, { first })` seats them: the
// very first time at blackjack with the minimum already bet, after that back at the last table.
export function firstDayCard(st, { onPlay, onBrowse, again = null }) {
  const acc = st.user.account;
  const first = isNewcomer(st);
  const day = st.user.today || {};
  const net = Number(day.net) || 0;
  const sign = net < 0 ? '-' : net > 0 ? '+' : '';
  const card = el('section', 'first-day');
  card.setAttribute('aria-labelledby', 'first-day-title');
  card.innerHTML = `
    <span class="first-day-kicker">${first ? '어서 오세요' : '오늘'}</span>
    <div class="first-day-money">
      <div><small>내 칩</small><b id="first-day-title">${wonCH(acc.available + acc.locked)}<em>원</em></b></div>
      <div><small>오늘 손익</small><b class="${net < 0 ? 'is-down' : net > 0 ? 'is-up' : 'is-zero'}">${sign}${wonCH(Math.abs(net))}<em>원</em></b>${day.rounds ? `<small>${day.rounds}판 · 잃은 돈 ${wonCH(day.lost || 0)}</small>` : ''}</div>
    </div>
    <button type="button" class="first-day-go" data-first-play></button>
    ${first ? '<p class="first-day-note">최소 금액이 걸린 채로 앉아요. 딜만 누르면 시작해요.</p>' : ''}
    <button type="button" class="first-day-more" data-first-browse>다른 게임 고르기</button>`;
  const go = card.querySelector('[data-first-play]');
  go.textContent = first || !again ? '블랙잭 한 판 하기' : `${again} 한 판 더`;
  go.addEventListener('click', () => onPlay(go, { first }));
  card.querySelector('[data-first-browse]').addEventListener('click', () => onBrowse());
  return card;
}
