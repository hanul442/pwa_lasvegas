// One Korean name per game wherever a player reads it: lobby, table header, rules, profile,
// news and the share cards. Internal ids (dice, poker, holdem…) and the server's English game
// labels ('Sic Bo', "Hold'em"…) both map here.
const BY_ID = { blackjack: '블랙잭', roulette: '룰렛', baccarat: '바카라', dice: '식보', matgo: '맞고', gostop: '고스톱', seotda: '섯다', poker: '홀덤', holdem: '홀덤', sevenpoker: '7포커', slots: '슬롯', horses: '경마' };
const BY_LABEL = { Blackjack: '블랙잭', Baccarat: '바카라', Roulette: '룰렛', 'Sic Bo': '식보', Matgo: '맞고', Gostop: '고스톱', Seotda: '섯다', "Hold'em": '홀덤', 'Seven Poker': '7포커', Slots: '슬롯', 'Horse Racing': '경마', Double: '묻고 더블' };

export const gameName = g => BY_ID[g] || BY_LABEL[g] || g || '';
