// Hwatu cards: the 48-card deck (mirrors lib/hwatu.mjs), drawn as flat modern SVG so every
// month is recognisable at phone size, with a month index for players still learning.
import { animate, sound, el, ms } from './fx.js';

const KINDS = {
  1: [['gwang'], ['tti', 'hong'], ['pi'], ['pi']],
  2: [['yeol', 'bird'], ['tti', 'hong'], ['pi'], ['pi']],
  3: [['gwang'], ['tti', 'hong'], ['pi'], ['pi']],
  4: [['yeol', 'bird'], ['tti', 'cho'], ['pi'], ['pi']],
  5: [['yeol'], ['tti', 'cho'], ['pi'], ['pi']],
  6: [['yeol'], ['tti', 'cheong'], ['pi'], ['pi']],
  7: [['yeol'], ['tti', 'cho'], ['pi'], ['pi']],
  8: [['gwang'], ['yeol', 'bird'], ['pi'], ['pi']],
  9: [['yeol', 'gukjin'], ['tti', 'cheong'], ['pi'], ['pi']],
  10: [['yeol'], ['tti', 'cheong'], ['pi'], ['pi']],
  11: [['gwang'], ['pi', 'double'], ['pi'], ['pi']],
  12: [['gwang', 'rain'], ['yeol'], ['tti'], ['pi', 'double']]
};
export const MONTH_NAMES = { 1: '송학', 2: '매조', 3: '벚꽃', 4: '흑싸리', 5: '난초', 6: '모란', 7: '홍싸리', 8: '공산', 9: '국진', 10: '단풍', 11: '오동', 12: '비' };
export const KIND_LABEL = { gwang: '광', yeol: '열끗', tti: '띠', pi: '피' };

export const DECK = {};
for (const [m, slots] of Object.entries(KINDS)) {
  slots.forEach(([kind, flag], i) => {
    const id = `${String(m).padStart(2, '0')}-${i + 1}`;
    DECK[id] = { id, month: Number(m), kind, ribbon: kind === 'tti' ? flag || null : null, bird: flag === 'bird', double: flag === 'double', gukjin: flag === 'gukjin', rain: flag === 'rain' };
  });
}
export const hwatu = id => DECK[id] || null;
export const isBombCard = id => typeof id === 'string' && id.startsWith('BOMB');
export const monthOf = id => DECK[id]?.month ?? 0;

// ---------- art ----------
const C = { ink: '#1a1714', red: '#c8352b', wine: '#8f1d1d', green: '#2f6b3f', pine: '#1f4a2c', indigo: '#283f73', violet: '#5b3a7a', pink: '#e9a6b2', gold: '#d9a531', moon: '#f3e7c4', bark: '#5a3a22', paper: '#f7f2e8' };

const blossom = (x, y, r, fill, core = C.gold) =>
  `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(Math.sin(a * Math.PI / 180) * r).toFixed(1)}" cy="${(-Math.cos(a * Math.PI / 180) * r).toFixed(1)}" r="${r * 0.72}" fill="${fill}"/>`).join('')}<circle r="${r * 0.45}" fill="${core}"/></g>`;
const leaf = (x, y, rot, s, fill) => `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0 0C6-8 16-8 22 0C16 8 6 8 0 0Z" fill="${fill}"/>`;
const bird = (x, y, s, fill = C.ink) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 4C4 0 8 0 11 3L16 1L13 5C15 9 10 12 4 10L-3 12L1 8Z" fill="${fill}"/><circle cx="${x + 9 * s}" cy="${y + 3.4 * s}" r="${0.8 * s}" fill="${C.paper}"/>`;
const ribbon = (kind, x = 22, y = 18) => {
  const fill = kind === 'cheong' ? C.indigo : C.red;
  const label = kind === 'hong' ? '홍단' : kind === 'cheong' ? '청단' : '';
  const text = label ? `<text x="${x + 8}" y="${y + 17}" font-size="7.5" font-weight="700" fill="${C.paper}" text-anchor="middle" writing-mode="tb" letter-spacing="1">${label}</text>` : '';
  const stripe = kind === null ? `<path d="M${x} ${y + 30}h16M${x} ${y + 34}h16" stroke="${C.ink}" stroke-width="1.6"/>` : '';
  return `<g transform="rotate(-6 ${x + 8} ${y + 22})"><path d="M${x} ${y}h16v42l-8-5l-8 5z" fill="${fill}"/><path d="M${x} ${y}h16v3h-16z" fill="#0003"/>${stripe}${text}</g>`;
};
const gwangMark = `<circle cx="11" cy="11" r="7.2" fill="${C.red}"/><circle cx="11" cy="11" r="7.2" fill="none" stroke="${C.paper}" stroke-width=".8" stroke-dasharray="1.2 1.4"/><text x="11" y="14" font-size="8.5" font-weight="700" fill="${C.paper}" text-anchor="middle">光</text>`;

const MOTIF = {
  1: c => `${c.kind === 'gwang' ? `<rect width="60" height="62" fill="${C.red}"/><circle cx="40" cy="20" r="11" fill="${C.moon}"/><path d="M12 54C16 40 26 36 34 40C30 30 38 26 44 30L50 26L46 34C52 40 44 50 36 48L26 58Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.2"/><path d="M44 30l4-6" stroke="${C.red}" stroke-width="2.4"/>` : ''}
    <g fill="${C.pine}"><path d="M4 76Q30 50 56 76Z"/><path d="M10 60Q28 40 46 60Z"/><path d="M18 46Q28 32 38 46Z"/></g><rect x="27" y="74" width="5" height="18" fill="${C.bark}"/>`,
  2: c => `<path d="M6 92C18 66 30 52 54 18" stroke="${C.ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M30 54C40 52 46 56 52 62" stroke="${C.ink}" stroke-width="2" fill="none"/>
    ${blossom(46, 26, 4.2, C.red)}${blossom(20, 70, 4.2, C.red)}${blossom(48, 60, 3.6, C.red)}${blossom(34, 44, 3.4, C.red)}
    ${c.kind === 'yeol' ? bird(10, 22, 1.7, C.green) : ''}`,
  3: c => `${blossom(16, 22, 6, C.pink, C.red)}${blossom(38, 16, 5, C.pink, C.red)}${blossom(48, 36, 6, C.pink, C.red)}${blossom(26, 40, 5.5, C.pink, C.red)}${blossom(12, 52, 4.4, C.pink, C.red)}
    ${c.kind === 'gwang' ? `<path d="M2 62h56v22H2z" fill="${C.red}"/><path d="M2 62h56M2 70h56M2 78h56" stroke="${C.paper}" stroke-width="1.4"/><path d="M8 84v8M30 84v8M52 84v8" stroke="${C.ink}" stroke-width="2"/>` : `<path d="M6 92C14 76 22 66 30 56" stroke="${C.bark}" stroke-width="3" fill="none"/>`}`,
  4: c => `<path d="M4 10C22 4 40 6 58 14" stroke="${C.ink}" stroke-width="2.6" fill="none"/>
    ${[12, 24, 36, 48].map((x, i) => Array.from({ length: 6 }, (_, k) => `<ellipse cx="${x + (k % 2 ? 1.5 : -1.5)}" cy="${16 + k * 8 + i * 2}" rx="3.2" ry="2.4" fill="${C.ink}"/>`).join('')).join('')}
    ${leaf(6, 20, 70, 0.8, C.pine)}${leaf(54, 22, 110, 0.8, C.pine)}
    ${c.kind === 'yeol' ? bird(22, 72, 1.8, C.gold) : ''}`,
  5: c => `${[10, 20, 30, 40, 50].map((x, i) => `<path d="M${x} 92C${x - 4} 70 ${x + 6} 50 ${x + (i % 2 ? 6 : -4)} 30" stroke="${C.green}" stroke-width="3" fill="none" stroke-linecap="round"/>`).join('')}
    ${[[16, 30], [40, 24], [28, 44]].map(([x, y]) => `<path d="M${x} ${y}l-6-8l6 3l6-3z M${x} ${y}l-5 6h10z" fill="${C.violet}"/>`).join('')}
    ${c.kind === 'yeol' ? `<path d="M4 76h52M8 76l6-8h32l6 8" stroke="${C.bark}" stroke-width="3" fill="none"/><path d="M14 76v10M46 76v10" stroke="${C.bark}" stroke-width="2.4"/>` : ''}`,
  6: c => `${leaf(8, 70, -30, 1.2, C.green)}${leaf(30, 74, -150, 1.1, C.green)}${leaf(24, 86, -80, 1, C.pine)}
    <g transform="translate(30 46)">${[0, 60, 120, 180, 240, 300].map(a => `<ellipse rx="9" ry="13" transform="rotate(${a}) translate(0 -8)" fill="${C.red}"/>`).join('')}<circle r="8" fill="${C.wine}"/><circle r="3.4" fill="${C.gold}"/></g>
    ${c.kind === 'yeol' ? `<g fill="${C.violet}"><path d="M8 18c-6-8 6-10 4 0c6-6 10 4 0 4z"/><path d="M48 14c-6-8 6-10 4 0c6-6 10 4 0 4z"/></g>` : ''}`,
  7: c => `<path d="M6 90C16 50 36 28 56 14" stroke="${C.bark}" stroke-width="2.4" fill="none"/><path d="M24 54C32 56 40 62 46 72" stroke="${C.bark}" stroke-width="1.8" fill="none"/>
    ${[[50, 18], [42, 24], [36, 32], [30, 40], [24, 50], [40, 64], [46, 72], [20, 60], [16, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${C.red}"/><circle cx="${x + 3}" cy="${y + 2}" r="1.8" fill="${C.wine}"/>`).join('')}
    ${c.kind === 'yeol' ? `<path d="M14 82C14 72 24 68 36 70C44 70 50 74 50 80L54 82L48 84C44 88 22 90 16 86Z" fill="${C.bark}"/><circle cx="46" cy="76" r="1.4" fill="${C.paper}"/>` : ''}`,
  8: c => `${c.kind === 'gwang' ? `<rect width="60" height="62" fill="${C.red}"/><circle cx="30" cy="30" r="16" fill="${C.moon}"/>` : ''}
    ${c.kind === 'yeol' ? `${bird(8, 14, 1.3)}${bird(26, 8, 1.3)}${bird(40, 20, 1.3)}` : ''}
    <path d="M0 62Q30 34 60 62V96H0Z" fill="${C.ink}"/><path d="M8 64l-2-8M16 58l-1-9M26 54l1-9M36 54l2-9M46 58l3-8M54 64l4-7" stroke="${C.paper}" stroke-width="1"/>`,
  9: c => `${leaf(10, 74, -40, 1.1, C.green)}${leaf(34, 80, -140, 1, C.green)}
    <g transform="translate(30 44)">${Array.from({ length: 16 }, (_, i) => `<ellipse rx="2.6" ry="12" transform="rotate(${i * 22.5}) translate(0 -9)" fill="${C.gold}"/>`).join('')}<circle r="6" fill="${C.red}"/></g>
    ${c.kind === 'yeol' ? `<path d="M10 14h22l-3 12h-16z" fill="${C.red}"/><path d="M14 18h14" stroke="${C.gold}" stroke-width="1.6"/>` : ''}`,
  10: c => `${[[16, 22, 0], [42, 18, 20], [30, 44, -10], [12, 60, 15], [46, 58, -20], [30, 76, 5]].map(([x, y, r]) => `<path transform="translate(${x} ${y}) rotate(${r})" d="M0-10L3-3L10-5L5 1L8 8L1 5L0 11L-1 5L-8 8L-5 1L-10-5L-3-3Z" fill="${C.red}"/>`).join('')}
    ${c.kind === 'yeol' ? `<path d="M14 92V76C14 66 22 64 30 66L40 62L42 54L46 62L50 58L48 66C50 70 46 74 42 72V92M22 92V78" stroke="${C.bark}" stroke-width="3.4" fill="none" stroke-linejoin="round"/>` : ''}`,
  11: c => `${c.kind === 'gwang' ? `<path d="M8 40C14 22 34 14 44 22C52 28 50 40 40 42C48 50 52 62 46 74C38 66 34 58 30 52C26 66 18 80 6 86C10 70 14 58 20 50C12 52 6 48 8 40Z" fill="${C.green}"/><path d="M40 22l10-6l-4 10z" fill="${C.gold}"/><circle cx="40" cy="26" r="1.6" fill="${C.paper}"/><path d="M30 52C26 66 18 80 6 86" stroke="${C.red}" stroke-width="2.4" fill="none"/>` : ''}
    <g fill="${c.double ? C.gold : C.ink}"><path d="M30 60C14 52 8 68 16 80C22 88 38 88 44 80C52 68 46 52 30 60Z"/></g><path d="M30 60V92" stroke="${C.gold}" stroke-width="2"/>
    ${c.double ? `<path d="M30 60C14 52 8 68 16 80C22 88 38 88 44 80C52 68 46 52 30 60Z" fill="none" stroke="${C.ink}" stroke-width="2"/>` : `${blossom(46, 40, 2.6, C.gold, C.violet)}${blossom(14, 40, 2.6, C.gold, C.violet)}`}`,
  12: c => c.double
    ? `<rect width="60" height="96" fill="${C.ink}"/><path d="M34 6L20 40H32L18 76L46 32H32L44 6Z" fill="${C.gold}"/><circle cx="14" cy="18" r="8" fill="${C.red}"/><circle cx="46" cy="70" r="8" fill="${C.red}"/>`
    : `${c.kind === 'gwang' ? `<rect width="60" height="96" fill="${C.wine}"/>` : ''}${[8, 20, 34, 48].map(x => `<path d="M${x} 0C${x + 6} 24 ${x - 4} 50 ${x + 4} 78" stroke="${c.kind === 'gwang' ? C.ink : C.green}" stroke-width="2" fill="none"/>`).join('')}
    ${c.kind === 'gwang' ? `<path d="M12 46Q30 26 48 46Z" fill="${C.red}"/><path d="M30 46v24" stroke="${C.ink}" stroke-width="2"/><circle cx="24" cy="58" r="4" fill="${C.moon}"/><path d="M20 62h8l2 22h-12z" fill="${C.indigo}"/>` : ''}
    ${c.kind === 'yeol' ? `<path d="M10 40L28 34L22 40L44 30L36 42L48 48L30 46L18 52Z" fill="${C.ink}"/><circle cx="40" cy="36" r="1.2" fill="${C.red}"/>` : ''}
    <path d="M0 84h60" stroke="${C.ink}" stroke-width="1.4" stroke-dasharray="4 3"/>`
};

export function hwatuSvg(id) {
  const c = hwatu(id);
  if (!c) return '';
  const dark = c.month === 12 && (c.double || c.kind === 'gwang');
  const ink = dark ? C.paper : C.ink;
  const tag = c.kind === 'gwang' ? '' : c.double ? '쌍피' : c.gukjin ? '끗·쌍' : c.kind === 'yeol' ? '끗' : c.kind === 'tti' ? '띠' : '';
  return `<svg class="hw-art" viewBox="0 0 60 96" aria-hidden="true" focusable="false">
    <rect width="60" height="96" fill="${C.paper}"/>${MOTIF[c.month](c)}
    ${c.kind === 'tti' ? ribbon(c.ribbon, 22, c.month === 12 ? 30 : 18) : ''}
    ${c.kind === 'gwang' ? gwangMark : ''}
    <g class="hw-index"><rect x="2.5" y="80.5" width="${c.month > 9 ? 15 : 11}" height="13" rx="3" fill="${dark ? '#0008' : '#fffd'}"/><text x="${c.month > 9 ? 10 : 8}" y="91" font-size="10" font-weight="700" fill="${ink}" text-anchor="middle">${c.month}</text></g>
    ${tag ? `<text x="56" y="91" font-size="7.5" font-weight="700" fill="${ink}" text-anchor="end" paint-order="stroke" stroke="${dark ? C.ink : C.paper}" stroke-width="2">${tag}</text>` : ''}
  </svg>`;
}

function label(id) {
  if (isBombCard(id)) return '폭탄 뒤 뒤집기 카드';
  const c = hwatu(id);
  if (!c) return '뒷면 화투';
  const kind = c.kind === 'tti' ? (c.ribbon === 'hong' ? '홍단' : c.ribbon === 'cheong' ? '청단' : c.ribbon === 'cho' ? '초단' : '띠') : c.double ? '쌍피' : KIND_LABEL[c.kind];
  return `${c.month}월 ${MONTH_NAMES[c.month]} ${kind}`;
}

export function createHwatu(id, { faceUp = true } = {}) {
  const node = el('div', 'hw');
  node.dataset.card = id || 'HIDDEN';
  node.style.setProperty('--tilt', `${(Math.random() * 3 - 1.5).toFixed(2)}deg`);
  const bomb = isBombCard(id);
  node.innerHTML = `<div class="hw-inner"><div class="hw-face${bomb ? ' hw-face--bomb' : ''}">${bomb ? '<span>뒤집기</span>' : hwatuSvg(id)}</div><div class="hw-back"></div></div>`;
  if (faceUp && (hwatu(id) || bomb)) node.classList.add('is-faceup');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', faceUp ? label(id) : '뒷면 화투');
  return node;
}

export function setHwatuFace(node, id) {
  if (!hwatu(id)) return;
  node.dataset.card = id;
  node.querySelector('.hw-face').innerHTML = hwatuSvg(id);
  node.setAttribute('aria-label', label(id));
}

export async function flipHwatu(node, id, { duration = 340, squeeze = false } = {}) {
  if (id) setHwatuFace(node, id);
  if (node.classList.contains('is-faceup')) return;
  const inner = node.querySelector('.hw-inner');
  sound.flip();
  const frames = squeeze
    ? [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(165deg) rotateX(18deg) scale(1.06)', offset: 0.5 }, { transform: 'rotateY(90deg) scale(1.1)', offset: 0.75 }, { transform: 'rotateY(0deg)' }]
    : [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(90deg) scale(1.08)', offset: 0.5 }, { transform: 'rotateY(0deg)' }];
  node.classList.add('is-turning');
  await animate(inner, frames, { duration: squeeze ? duration * 3 : duration, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'none' });
  node.classList.add('is-faceup');
  node.classList.remove('is-turning');
}

// The slap: a played card lands with a little bounce, the way a hwatu card hits the blanket.
export function slap(node) {
  sound.card();
  return animate(node, [{ transform: 'scale(1.18)' }, { transform: 'scale(.94)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: ms(220), fill: 'none' });
}
