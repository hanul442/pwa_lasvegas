// Hwatu (화투) deck shared by 맞고 and 섯다. Card ids are "MM-N" (month, slot 1–4).
import crypto from 'node:crypto';

// Per month, the four cards in printed order. kind: gwang | yeol | tti | pi.
const MONTHS = {
  1: [['gwang'], ['tti', { ribbon: 'hong' }], ['pi'], ['pi']],
  2: [['yeol', { bird: true }], ['tti', { ribbon: 'hong' }], ['pi'], ['pi']],
  3: [['gwang'], ['tti', { ribbon: 'hong' }], ['pi'], ['pi']],
  4: [['yeol', { bird: true }], ['tti', { ribbon: 'cho' }], ['pi'], ['pi']],
  5: [['yeol'], ['tti', { ribbon: 'cho' }], ['pi'], ['pi']],
  6: [['yeol'], ['tti', { ribbon: 'cheong' }], ['pi'], ['pi']],
  7: [['yeol'], ['tti', { ribbon: 'cho' }], ['pi'], ['pi']],
  8: [['gwang'], ['yeol', { bird: true }], ['pi'], ['pi']],
  9: [['yeol', { gukjin: true }], ['tti', { ribbon: 'cheong' }], ['pi'], ['pi']],
  10: [['yeol'], ['tti', { ribbon: 'cheong' }], ['pi'], ['pi']],
  11: [['gwang'], ['pi', { double: true }], ['pi'], ['pi']],
  12: [['gwang', { rain: true }], ['yeol'], ['tti'], ['pi', { double: true }]]
};

export const MONTH_NAMES = { 1: '송학', 2: '매조', 3: '벚꽃', 4: '흑싸리', 5: '난초', 6: '모란', 7: '홍싸리', 8: '공산', 9: '국진', 10: '단풍', 11: '오동', 12: '비' };

function make(month, slot) {
  const [kind, flags = {}] = MONTHS[month][slot - 1];
  return { id: `${String(month).padStart(2, '0')}-${slot}`, month, kind, ...flags };
}

export const HWATU = Object.freeze(Object.keys(MONTHS).flatMap(m => [1, 2, 3, 4].map(s => Object.freeze(make(Number(m), s)))));
const BY_ID = new Map(HWATU.map(c => [c.id, c]));
export const cardById = cardId => BY_ID.get(cardId) || null;

export const defaultRng = max => crypto.randomInt(0, max);

export function shuffle(cards, rng = defaultRng) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 섯다 uses months 1–10, two cards each: the special card (광 or 열끗) and one 피.
export const SEOTDA_DECK = Object.freeze(Array.from({ length: 10 }, (_, i) => [cardById(`${String(i + 1).padStart(2, '0')}-1`), cardById(`${String(i + 1).padStart(2, '0')}-3`)]).flat());
