// Named vibration patterns, one per table action, so a hit, a stand, a chip landing and a win
// each feel different in the hand. Every pattern goes through fx.js haptic(), which respects
// the 진동 setting. Numbers are milliseconds: buzz, pause, buzz…
import { haptic } from './fx.js';

export const PATTERNS = {
  card: 6,                      // a card lands in front of you
  flip: 4,                      // a card turns over
  slap: [18, 24, 6],            // a hwatu card slapped down on the blanket, then the bounce
  chip: 10,                     // a chip set down on a spot
  chipThrow: [6, 30, 14],       // a flicked chip: leaves the hand, then lands
  step: 8,                      // − / + nudges the bet
  hit: [12, 40, 12],            // two taps on the felt: "card please"
  stand: [4, 18, 4, 18, 4],     // a hand waved flat over the cards
  double: [16, 50, 16],
  split: [10, 30, 10, 30, 10],
  shuffle: [4, 24, 4, 24, 4, 24, 4, 24, 4, 60, 18], // the riffle, then the deck squared
  rake: [22, 30, 8],            // the house takes the chips
  pay: [8, 40, 8, 40, 14],      // a stack slid over to you
  win: [20, 60, 30],
  bigWin: [30, 50, 30, 50, 60],
  lose: 30,
  ouch: [120, 60, 220],          // a loss of two max bets or more in one hand
  push: [10, 80, 10],
  reject: [10, 40, 10]
};

export function buzz(name) {
  const pattern = PATTERNS[name];
  if (pattern != null) haptic(pattern);
}
