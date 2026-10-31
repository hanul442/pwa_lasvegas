// 층 입장 (2026-10-30, 한서 "들어갈 때 문이 열리면서 아 내가 여기를 들어왔구나"): every floor has its
// own door that opens onto the room, before the buy-in and the table. 1F HALL glass doors, 2F CLUB
// curtains, 3F SALON lacquer doors, 4F PENTHOUSE elevator, 5F SKY a rising skyline, 6F VAULT a round
// vault door, 7F CROWN a split crest, 8F OLYMPUS a veil of light.
// About 1.2s the first time this session, 0.55s on later visits, a tap skips it, and reduced motion
// gets the floor's name plate with a fade. Only transform and opacity animate (memory: performance).
import { el, haptic, formatCH, wonCH } from './fx.js';

const SEEN = 'vegas:door-seen';
const seen = () => { try { return JSON.parse(sessionStorage.getItem(SEEN) || '[]'); } catch { return []; } };
const markSeen = slug => { try { sessionStorage.setItem(SEEN, JSON.stringify([...new Set([...seen(), slug])])); } catch {} };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Door markup per floor, drawn with CSS (floor-door.css): no images to download.
const WHEEL = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="none" stroke="#c9ced6" stroke-width="4"/><circle cx="50" cy="50" r="10" fill="#2a2e33" stroke="#c9ced6" stroke-width="3"/><g stroke="#c9ced6" stroke-width="5" stroke-linecap="round"><line x1="50" y1="40" x2="50" y2="8"/><line x1="58.7" y1="55" x2="86" y2="71"/><line x1="41.3" y1="55" x2="14" y2="71"/></g><g fill="#f4f5f7"><circle cx="50" cy="6" r="5"/><circle cx="88" cy="72" r="5"/><circle cx="12" cy="72" r="5"/></g></svg>';
const CROWN = '<svg viewBox="0 0 120 70" aria-hidden="true"><path d="M10 60 L18 18 L40 40 L60 8 L80 40 L102 18 L110 60 Z" fill="none" stroke="#e9e3d4" stroke-width="3" stroke-linejoin="round"/><line x1="10" y1="66" x2="110" y2="66" stroke="#e9e3d4" stroke-width="3"/></svg>';
const SKYLINE = '<svg viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 120V80h12V60h10v20h8V40h14v40h6V70h12v50h8V50l8-10 8 10v70h6V64h16v56h6V30h4V18h4v12h4v90h8V72h14v48h8V56h10v64h10V84h12v36z" fill="#1c2026"/></svg>';
const doors = {
  'gold-room': () => '<i class="door-leaf door-leaf--l"></i><i class="door-leaf door-leaf--r"></i>',
  'high-limit': () => '<i class="door-leaf door-leaf--l"></i><i class="door-leaf door-leaf--r"></i><i class="door-rope"></i>',
  'salon-prive': () => '<i class="door-leaf door-leaf--l"></i><i class="door-leaf door-leaf--r"></i>',
  penthouse: () => `<span class="door-lift" aria-hidden="true"><b data-door-count>1</b></span><i class="door-leaf door-leaf--l"></i><i class="door-leaf door-leaf--r"></i>`,
  'sky-lounge': () => `<span class="door-sky">${SKYLINE}${SKYLINE}</span><i class="door-leaf door-leaf--l"></i><i class="door-leaf door-leaf--r"></i>`,
  vault: () => `<span class="door-vault"><i class="door-vault-glow"></i><span class="door-vault-door">${Array.from({ length: 8 }, (_, i) => `<i class="door-bolt" style="--a:${i * 45}deg"></i>`).join('')}<i class="door-vault-ring"></i><span class="door-vault-wheel">${WHEEL}</span><i class="door-vault-mark">VEGAS · 06</i></span></span>`,
  crown: () => `<i class="door-leaf door-leaf--l"><span class="door-crest">${CROWN}</span></i><i class="door-leaf door-leaf--r"><span class="door-crest">${CROWN}</span></i>`,
  olympus: () => '<i class="door-pillar door-pillar--l"></i><i class="door-pillar door-pillar--r"></i><i class="door-veil"></i>'
};

// Opens the floor's door over the screen. `opened` resolves once the room shows (the plate is up), and
// `close()` fades the room away onto the table. `short` forces the quick version.
export function floorDoor(tier, { game = null, event = null, short } = {}) {
  const slug = doors[tier.floor || tier.slug] ? (tier.floor || tier.slug) : 'gold-room';
  const quick = short ?? seen().includes(slug);
  const calm = reduced();
  markSeen(slug);
  document.querySelectorAll('.floor-door').forEach(n => n.remove());
  const root = el('div', `floor-door floor-door--${slug}${quick ? ' is-quick' : ''}${calm ? ' is-calm' : ''}`);
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', `${tier.no}층 ${tier.name} 입장`);
  const stars = tier.stars ? `<em class="floor-door-stars" aria-hidden="true">${'★'.repeat(tier.stars)}${'☆'.repeat(5 - tier.stars)}</em>` : '';
  root.innerHTML = `<div class="floor-door-room" aria-hidden="true"><i class="floor-door-lamp"></i><i class="floor-door-felt"></i></div>
    <div class="floor-door-plate"><small>${tier.no}F</small><strong style="--len:${(tier.en || tier.name).length}">${tier.en || tier.name}</strong><span>${[tier.name, event || game, `${wonCH(tier.min)}–${wonCH(tier.max)}원`].filter(Boolean).join(' · ')}</span>${stars}</div>
    <div class="floor-door-gate" aria-hidden="true">${doors[slug]()}</div>
    <span class="floor-door-skip" aria-hidden="true">누르면 건너뛰기</span>`;
  document.body.append(root);
  document.body.classList.add('has-floor-door');
  // Timeline: arm (the wheel turns, the lift counts), open (doors part), lit (the room and plate), done.
  const T = calm ? { arm: 0, open: 0, lit: 0, done: 380 } : quick ? { arm: 0, open: 40, lit: 260, done: 560 } : { arm: 90, open: 560, lit: 820, done: 1220 };
  const timers = [];
  let doneFn;
  const opened = new Promise(r => { doneFn = r; });
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const finish = () => {
    timers.forEach(clearTimeout);
    root.classList.add('is-armed', 'is-open', 'is-lit', 'is-done');
    countTo(true);
    doneFn();
  };
  // The penthouse lift's indicator climbs to its floor while the doors are shut.
  const count = root.querySelector('[data-door-count]');
  const countTo = (jump = false) => {
    if (!count) return;
    if (jump || quick || calm) { count.textContent = tier.no; return; }
    for (let i = 2; i <= tier.no; i++) at(T.arm + ((T.open - T.arm - 60) * (i - 1)) / (tier.no - 1), () => { count.textContent = i; });
  };
  requestAnimationFrame(() => {
    root.classList.add('is-on');
    at(T.arm, () => { root.classList.add('is-armed'); countTo(); });
    at(T.open, () => { root.classList.add('is-open'); haptic?.(quick ? 6 : [8, 40, 12]); });
    at(T.lit, () => root.classList.add('is-lit'));
    at(T.done, finish);
  });
  root.addEventListener('pointerdown', () => { if (!root.classList.contains('is-done')) finish(); });
  let closed = false;
  return {
    opened,
    close() {
      if (closed) return;
      closed = true;
      timers.forEach(clearTimeout);
      root.classList.add('is-leaving');
      setTimeout(() => { root.remove(); if (!document.querySelector('.floor-door')) document.body.classList.remove('has-floor-door'); }, calm ? 160 : 320);
    }
  };
}
