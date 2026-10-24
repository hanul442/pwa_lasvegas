// 족보 도감: the rare hands a player has made (lib/hand-book.mjs). The profile shows how full the
// book is; the book itself opens over any screen, one page per game. A hand made for the first
// time stops by at the top of the screen, at the table too, with a card to brag about it.
import { el, sound, haptic, ms, reducedMotion } from './fx.js';
import { createCard } from './cards.js';
import { createHwatu, hwatuSvg } from './hwatu.js';
import { loadLogo } from './bigwin.js';

// What each square shows: playing cards, hwatu, or a token for the casino tables.
const ART = {
  'sd-38': { hw: ['03-1', '08-1'] }, 'sd-18': { hw: ['01-1', '08-1'] }, 'sd-13': { hw: ['01-1', '03-1'] },
  'sd-jang': { hw: ['10-1', '10-3'] }, 'sd-ttaeng': { hw: ['05-1', '05-3'] }, 'sd-ali': { hw: ['01-3', '02-3'] },
  'sd-doksa': { hw: ['01-3', '04-3'] }, 'sd-gubbing': { hw: ['01-3', '09-3'] }, 'sd-jangbbing': { hw: ['01-3', '10-3'] },
  'sd-jangsa': { hw: ['04-3', '10-3'] }, 'sd-seryuk': { hw: ['04-3', '06-3'] }, 'sd-gabo': { hw: ['02-3', '07-3'] },
  'sd-mangtong': { hw: ['03-3', '07-3'] }, 'sd-amhaeng': { hw: ['04-1', '07-1'] }, 'sd-ttaengjabi': { hw: ['03-1', '07-1'] },
  'sd-gusa': { hw: ['04-3', '09-3'] }, 'sd-mgusa': { hw: ['04-1', '09-1'] },
  'hw-ogwang': { hw: ['01-1', '03-1', '08-1', '11-1', '12-1'] }, 'hw-sagwang': { hw: ['01-1', '03-1', '08-1', '11-1'] },
  'hw-samgwang': { hw: ['01-1', '03-1', '08-1'] }, 'hw-bisamgwang': { hw: ['01-1', '03-1', '12-1'] },
  'hw-godori': { hw: ['02-1', '04-1', '08-2'] }, 'hw-hongdan': { hw: ['01-2', '02-2', '03-2'] },
  'hw-cheongdan': { hw: ['06-2', '09-2', '10-2'] }, 'hw-chodan': { hw: ['04-2', '05-2', '07-2'] },
  'hw-threego': { token: '3고', sub: 'GO GO GO' }, 'hw-shake': { hw: ['05-1', '05-2', '05-3'] },
  'hw-meongtta': { hw: ['02-1', '04-1', '05-1', '06-1', '07-1', '08-2', '10-1'] },
  'hw-pibak': { hw: ['11-2', '12-4', '01-3', '02-3', '03-3'] }, 'hw-gwangbak': { hw: ['01-1', '08-1', '11-1'] },
  'pk-royal': { cards: 'A♠ K♠ Q♠ J♠ 10♠' }, 'pk-sf': { cards: '9♥ 8♥ 7♥ 6♥ 5♥' }, 'pk-quads': { cards: 'K♠ K♥ K♦ K♣ 2♠' },
  'pk-full': { cards: 'Q♠ Q♥ Q♦ 7♣ 7♦' }, 'pk-flush': { cards: 'K♦ J♦ 9♦ 6♦ 2♦' }, 'pk-mountain': { cards: 'A♣ K♦ Q♠ J♥ 10♣' },
  'pk-back': { cards: '5♠ 4♦ 3♣ 2♥ A♠' }, 'pk-straight': { cards: '9♣ 8♦ 7♠ 6♥ 5♣' }, 'pk-trips': { cards: '8♠ 8♥ 8♦' },
  'bj-natural': { cards: 'A♠ K♥' }, 'bj-suited': { cards: 'A♠ K♠' }, 'bj-777': { cards: '7♠ 7♥ 7♦' },
  'bj-five': { cards: '2♠ 3♥ 4♦ 2♣ 5♠' }, 'bj-perfect': { cards: 'Q♥ Q♥' }, 'bj-suitedtrips': { cards: '9♣ 9♣ 9♣' },
  'bac-natural': { cards: '5♦ 4♠' }, 'bac-tie': { cards: 'Q♦ 7♣ K♠ 7♥' }, 'bac-pair': { cards: '8♠ 8♦' },
  'rl-straight': { token: '17', tone: 'red' }, 'rl-zero': { token: '0', tone: 'green' }, 'rl-lightning': { token: '500×', sub: 'LIGHTNING' },
  'sb-triple': { dice: [6, 6, 6] }, 'sb-edge': { dice: [6, 6, 5], sub: '합 17' },
  'sl-seven': { token: '7 7 7', tone: 'red' }, 'sl-free': { token: 'FREE', sub: '× 3' }, 'sl-jackpot': { token: '★ ★ ★', tone: 'star' }
};
const PAGE_GAME = { seotda: '섯다', hwatu: '고스톱·맞고', poker: '포커', blackjack: '블랙잭', baccarat: '바카라', roulette: '룰렛', dice: '식보', slots: '슬롯' };
const TIER_NAME = { 1: '흔한 족보', 2: '귀한 족보', 3: '전설의 족보' };

const PIPS = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[26, 26], [50, 50], [74, 74]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]], 6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]] };
const dieSvg = n => `<svg class="jk-die" viewBox="0 0 100 100" aria-hidden="true"><rect x="4" y="4" width="92" height="92" rx="20"/>${PIPS[n].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9"/>`).join('')}</svg>`;

// One square's art. `got` false draws the same shape in shadow: card backs, a blank token.
export function entryArt(id, { got = true, big = false } = {}) {
  const a = ART[id] || { token: '?' };
  const box = el('div', `jk-art${big ? ' jk-art--big' : ''}${got ? '' : ' is-missing'}`);
  box.setAttribute('aria-hidden', 'true');
  if (a.hw) {
    box.classList.add('jk-art--hw', `jk-n${a.hw.length}`);
    box.append(...a.hw.map(x => createHwatu(x, { faceUp: got })));
  } else if (a.cards) {
    const list = a.cards.split(' ');
    box.classList.add('jk-art--cards', `jk-n${list.length}`);
    box.append(...list.map(x => createCard(x, { faceUp: got })));
  } else if (a.dice) {
    box.classList.add('jk-art--dice');
    box.innerHTML = got ? a.dice.map(dieSvg).join('') : '<span class="jk-token">?</span>';
  } else {
    box.classList.add('jk-art--token');
    box.innerHTML = got ? `<span class="jk-token${a.tone ? ` jk-token--${a.tone}` : ''}">${a.token}</span>${a.sub ? `<small>${a.sub}</small>` : ''}` : '<span class="jk-token">?</span>';
  }
  return box;
}

const stars = tier => `<span class="jk-stars jk-stars--${tier}" aria-label="${TIER_NAME[tier]}">${'<i></i>'.repeat(tier)}</span>`;
const day = iso => iso ? new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '';
const josa = (word, withJong, without) => {
  const code = String(word).trim().charCodeAt(String(word).trim().length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? withJong : without;
  return /[0-9LMN]$/i.test(word) ? withJong : without;
};
export const withObject = word => `${word}${josa(word, '을', '를')}`;

// ---------- the profile block ----------
export function handBookBlock(state) {
  const hb = state?.handBook;
  const box = el('div', 'jk-summary');
  if (!hb) return box;
  const latest = hb.entries.filter(e => e.got).sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, 3);
  box.innerHTML = `
    <button type="button" class="jk-summary-open" data-open-book>
      <span class="jk-summary-head"><b>${hb.count}</b><small>/ ${hb.total}</small><span class="jk-summary-cta">도감 펼치기</span></span>
      <span class="jk-bar"><i style="width:${Math.round((hb.count / hb.total) * 100)}%"></i></span>
      <span class="jk-summary-pages">${hb.pages.map(p => `<span class="${p.count === p.total ? 'is-full' : ''}">${p.name}<b>${p.count}/${p.total}</b></span>`).join('')}</span>
      <span class="jk-summary-note">${latest.length ? `최근: ${latest.map(e => e.name).join(' · ')}` : '섯다 광땡, 로열 스트레이트 플러시, 쓰리고… 처음 잡는 족보가 여기에 한 칸씩 채워져요.'}</span>
    </button>
    <p class="jk-summary-reward">절반 모으면 <b>족보 명패</b>, 전부 모으면 <b>족보 마스터 명패</b>. 시즌이 바뀌어도 도감은 그대로예요.</p>`;
  box.querySelector('[data-open-book]').addEventListener('click', () => openHandBook(state));
  return box;
}

// ---------- the book ----------
let lastPage = (() => { try { return localStorage.getItem('vegas:jokbo-page'); } catch { return null; } })();
export function openHandBook(state, page = null) {
  const hb = state?.handBook;
  if (!hb) return;
  document.querySelector('.jk-book')?.remove();
  const nickname = state.user?.nickname || '';
  let current = page || (hb.pages.some(p => p.id === lastPage) ? lastPage : hb.pages[0].id);
  const node = el('section', 'jk-book');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-labelledby', 'jk-title');
  node.innerHTML = `
    <header class="jk-book-head">
      <div><p class="lounge-eyebrow">COLLECTION</p><h2 id="jk-title">족보 도감 <small>${hb.count} / ${hb.total}</small></h2></div>
      <button type="button" class="jk-close" aria-label="닫기" data-close></button>
    </header>
    <div class="jk-bar jk-bar--book"><i style="width:${Math.round((hb.count / hb.total) * 100)}%"></i></div>
    <nav class="jk-tabs" role="tablist" aria-label="게임"></nav>
    <div class="jk-page" role="tabpanel"></div>
    <footer class="jk-book-foot"><button type="button" class="pill-button" data-share-book>도감 자랑하기</button></footer>`;
  const tabs = node.querySelector('.jk-tabs');
  const panel = node.querySelector('.jk-page');
  const paint = () => {
    try { localStorage.setItem('vegas:jokbo-page', current); } catch {}
    tabs.replaceChildren(...hb.pages.map(p => {
      const b = el('button', `jk-tab${p.id === current ? ' is-active' : ''}${p.count === p.total ? ' is-full' : ''}`, `${p.name} <small>${p.count}/${p.total}</small>`);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(p.id === current));
      b.addEventListener('click', () => { current = p.id; paint(); panel.scrollTop = 0; });
      return b;
    }));
    tabs.querySelector('.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    const list = el('ul', 'jk-grid');
    list.append(...hb.entries.filter(e => e.page === current).map(e => {
      const li = el('li', `jk-tile jk-tile--${e.tier}${e.got ? ' is-got' : ''}`);
      const b = el('button', 'jk-tile-btn');
      b.type = 'button';
      b.setAttribute('aria-label', `${e.name}${e.got ? `, ${e.count}번 잡음` : ', 아직 못 잡음'}`);
      b.append(entryArt(e.id, { got: e.got }));
      const text = el('div', 'jk-tile-text', `<b>${e.name}</b>${stars(e.tier)}<small>${e.desc}</small><small class="jk-when">${e.got ? `${day(e.at)} 처음 · ${e.count}번` : '아직 못 잡았어요'}</small>`);
      b.append(text);
      b.addEventListener('click', () => openEntry(e, { nickname, hb }));
      li.append(b);
      return li;
    }));
    panel.replaceChildren(list);
  };
  paint();
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('is-open'));
  const close = () => {
    removeEventListener('keydown', onKey, true);
    node.classList.remove('is-open');
    setTimeout(() => node.remove(), ms(300));
  };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.jk-detail')) { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-close]').addEventListener('click', close);
  node.querySelector('[data-share-book]').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    await shareBook(hb, nickname).catch(() => {});
    e.currentTarget.disabled = false;
  });
  node.querySelector('[data-close]').focus({ preventScroll: true });
}

// One square, big: the hand, how rare it is, and when it came up.
function openEntry(e, { nickname, hb }) {
  const scrim = el('div', 'lounge-scrim');
  const sheet = el('section', 'lounge-sheet jk-detail');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `<p class="lounge-eyebrow">${PAGE_GAME[e.page]} · ${TIER_NAME[e.tier]}</p><h2>${e.got ? e.name : `${e.name} <small>미획득</small>`}</h2>`;
  sheet.append(entryArt(e.id, { got: e.got, big: true }));
  sheet.append(el('p', 'jk-detail-desc', `${e.desc}${e.got ? `<br><small>${day(e.at)}에 처음 잡았고, 지금까지 ${e.count}번 나왔어요.</small>` : '<br><small>처음 잡는 순간 이 칸이 채워져요.</small>'}`));
  const actions = el('div', 'lounge-sheet-actions');
  const cancel = el('button', 'pill-button', '닫기');
  cancel.type = 'button';
  actions.append(cancel);
  if (e.got) {
    const share = el('button', 'pill-button pill-button--solid', '동네방네 자랑하기');
    share.type = 'button';
    share.addEventListener('click', async () => { share.disabled = true; await shareEntry(e, { nickname, count: hb.count, total: hb.total }).catch(() => {}); share.disabled = false; });
    actions.append(share);
  }
  sheet.append(actions);
  document.body.append(scrim, sheet);
  requestAnimationFrame(() => { scrim.classList.add('is-open'); sheet.classList.add('is-open'); cancel.focus({ preventScroll: true }); });
  const close = () => {
    removeEventListener('keydown', onKey, true);
    scrim.classList.remove('is-open'); sheet.classList.remove('is-open');
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 320);
  };
  const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', close);
  cancel.addEventListener('click', close);
}

// ---------- a new hand ----------
// Every answer that carries the player's state passes through here (js/api.js): squares that
// were empty in the last answer and are filled in this one get their moment.
let known = null;
let latest = null;
const queue = [];
let showing = false;
// How long the table needs to show the hand before the moment may cover the top of the screen.
const WAIT = { roulette: 6200, slots: 3200, dice: 3600, poker: 2600, seotda: 2400, hwatu: 2200 };
export function watchHandBook() {
  addEventListener('vegas:state', e => {
    const st = e.detail;
    const hb = st?.handBook;
    if (!hb) return;
    latest = st;
    const got = new Set(hb.entries.filter(x => x.got).map(x => x.id));
    const userId = st.user?.id;
    if (!known || known.userId !== userId) { known = { userId, got }; return; }
    const fresh = hb.entries.filter(x => x.got && !known.got.has(x.id));
    known.got = got;
    for (const entry of fresh) queue.push({ entry, at: Date.now() + (WAIT[entry.page] ?? 1600) });
    pump();
  });
  addEventListener('vegas:signed-out', () => { known = null; queue.length = 0; });
}

function pump() {
  if (showing || !queue.length) return;
  const next = queue[0];
  const wait = next.at - Date.now();
  // A big-win or bust screen goes first; the new square waits its turn behind it.
  if (wait > 0 || document.querySelector('.bigwin, .bust, .acquire, .floor-moment')) { setTimeout(pump, Math.max(400, wait)); return; }
  queue.shift();
  showing = true;
  handMoment(next.entry, latest).then(() => { showing = false; setTimeout(pump, 300); });
}

export function handMoment(entry, st) {
  return new Promise(resolve => {
    const hb = st?.handBook;
    const node = el('div', `jk-moment jk-moment--${entry.tier}`);
    node.setAttribute('role', 'status');
    node.innerHTML = `
      <div class="jk-moment-card">
        <div class="jk-moment-art"></div>
        <div class="jk-moment-text">
          <p class="jk-moment-eyebrow"><span aria-hidden="true"></span>족보 도감 NEW · ${PAGE_GAME[entry.page]}</p>
          <h2>${entry.name}</h2>
          <p>${hb ? `${hb.count} / ${hb.total}칸 채움` : ''}${stars(entry.tier)}</p>
        </div>
        <div class="jk-moment-actions">
          <button type="button" class="pill-button pill-button--solid" data-share>자랑하기</button>
          <button type="button" class="pill-button" data-book>도감</button>
        </div>
      </div>`;
    node.querySelector('.jk-moment-art').append(entryArt(entry.id));
    document.body.append(node);
    requestAnimationFrame(() => node.classList.add('is-open'));
    sound.win?.();
    haptic(entry.tier === 3 ? [30, 40, 30, 40, 120] : [20, 30, 40]);
    if (entry.tier === 3 && !reducedMotion()) node.classList.add('is-legend');
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      node.classList.remove('is-open');
      setTimeout(() => { node.remove(); resolve(); }, ms(320));
    };
    let timer = setTimeout(close, ms(entry.tier === 3 ? 7000 : 5200) + 800);
    node.querySelector('[data-share]').addEventListener('click', async e => {
      clearTimeout(timer);
      e.currentTarget.disabled = true;
      await shareEntry(entry, { nickname: st?.user?.nickname || '', count: hb?.count, total: hb?.total }).catch(() => {});
      close();
    });
    node.querySelector('[data-book]').addEventListener('click', () => { close(); openHandBook(st, entry.page); });
  });
}

// ---------- share cards ----------
const W = 1080, H = 1350;
function base(ctx) {
  const bg = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.4, H * 0.8);
  bg.addColorStop(0, '#1f242b'); bg.addColorStop(1, '#0a0b0d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);
}
function star(ctx, x, y, r, color) {
  const pts = [[0, -1], [0.2, -0.2], [1, 0], [0.2, 0.2], [0, 1], [-0.2, 0.2], [-1, 0], [-0.2, -0.2]];
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + px * r, y + py * r));
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function fit(ctx, text, weight, size, max, min = 40) {
  ctx.font = `${weight} ${size}px Archivo, "Noto Sans KR", sans-serif`;
  while (ctx.measureText(text).width > max && size > min) { size -= 6; ctx.font = `${weight} ${size}px Archivo, "Noto Sans KR", sans-serif`; }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const svgImage = svg => new Promise(resolve => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}`;
});
// The hand itself, laid out across the middle of the card.
async function drawArt(ctx, id, cy) {
  const a = ART[id] || {};
  const cx = W / 2;
  if (a.hw || a.cards) {
    const list = a.hw || a.cards.split(' ');
    const n = list.length;
    const w = a.hw ? Math.min(170, 760 / n) : Math.min(190, 820 / n), h = a.hw ? w * 1.6 : w * 1.4;
    const gap = Math.min(w * 1.08, 880 / n);
    const x0 = cx - (gap * (n - 1) + w) / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * gap, y = cy - h / 2, tilt = (i - (n - 1) / 2) * 0.04;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2); ctx.rotate(tilt); ctx.translate(-w / 2, -h / 2);
      ctx.shadowColor = '#000a'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
      if (a.hw) {
        const img = await svgImage(hwatuSvg(list[i]));
        roundRect(ctx, 0, 0, w, h, w * 0.08); ctx.fillStyle = '#f7f2e8'; ctx.fill();
        ctx.shadowColor = 'transparent';
        if (img) { ctx.save(); roundRect(ctx, 0, 0, w, h, w * 0.08); ctx.clip(); ctx.drawImage(img, 0, 0, w, h); ctx.restore(); }
      } else {
        const t = list[i], rank = t.slice(0, -1), suit = t.slice(-1), red = suit === '♥' || suit === '♦';
        roundRect(ctx, 0, 0, w, h, w * 0.08); ctx.fillStyle = '#fbf8f2'; ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = red ? '#a3221d' : '#1a1714';
        ctx.textAlign = 'left';
        ctx.font = `700 ${w * 0.26}px Archivo, sans-serif`;
        ctx.fillText(rank, w * 0.09, w * 0.3);
        ctx.font = `400 ${w * 0.22}px sans-serif`;
        ctx.fillText(suit, w * 0.1, w * 0.54);
        ctx.textAlign = 'center';
        ctx.font = `400 ${w * 0.62}px sans-serif`;
        ctx.fillText(suit, w / 2, h * 0.7);
      }
      ctx.restore();
    }
    return;
  }
  ctx.textAlign = 'center';
  if (a.dice) {
    const s = 170, gap = 210, x0 = cx - gap;
    a.dice.forEach((n, i) => {
      const x = x0 + i * gap - s / 2, y = cy - s / 2;
      roundRect(ctx, x, y, s, s, 34); ctx.fillStyle = '#f4f5f7'; ctx.fill();
      ctx.fillStyle = '#0a0b0d';
      for (const [px, py] of PIPS[n]) { ctx.beginPath(); ctx.arc(x + (px / 100) * s, y + (py / 100) * s, s * 0.09, 0, Math.PI * 2); ctx.fill(); }
    });
    return;
  }
  ctx.fillStyle = a.tone === 'red' ? '#ff6b5f' : a.tone === 'green' ? '#3fbf7f' : a.tone === 'star' ? '#fff6dc' : '#f4f5f7';
  fit(ctx, a.token || '?', 700, 200, 800, 80);
  ctx.fillText(a.token || '?', cx, cy + 60);
}

async function entryCard(entry, { nickname = '', count, total } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  base(ctx);
  const logo = await loadLogo();
  if (logo) ctx.drawImage(logo, W / 2 - 150, 110, 300, 63);
  ctx.textAlign = 'center';
  ctx.fillStyle = entry.tier === 3 ? '#fff6dc' : '#b3b8bf';
  ctx.font = '500 38px "Noto Sans KR", Archivo, sans-serif';
  ctx.fillText(`족보 도감 · ${PAGE_GAME[entry.page]} · ${TIER_NAME[entry.tier]}`, W / 2, 268);
  if (entry.tier === 3) { star(ctx, 150, 250, 26, '#fff6dc'); star(ctx, W - 150, 250, 26, '#fff6dc'); }
  await drawArt(ctx, entry.id, 560);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f4f5f7';
  fit(ctx, entry.name, 700, 120, W - 180, 60);
  ctx.fillText(entry.name, W / 2, 900);
  ctx.fillStyle = '#c4c9cf';
  ctx.font = '500 42px "Noto Sans KR", sans-serif';
  ctx.fillText(entry.desc, W / 2, 975);
  if (count != null) {
    ctx.fillStyle = '#fff6dc';
    ctx.font = '700 54px Archivo, "Noto Sans KR", sans-serif';
    ctx.fillText(`도감 ${count} / ${total}`, W / 2, 1080);
  }
  ctx.fillStyle = '#7d838b';
  ctx.font = '400 32px "Noto Sans KR", sans-serif';
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(`${nickname ? `${nickname} · ` : ''}${date}`, W / 2, 1170);
  ctx.fillText('가상 칩 · 현금 가치 없음', W / 2, 1225);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function bookCard(hb, nickname = '') {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  base(ctx);
  const logo = await loadLogo();
  if (logo) ctx.drawImage(logo, W / 2 - 150, 110, 300, 63);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b3b8bf';
  ctx.font = '500 40px "Noto Sans KR", sans-serif';
  ctx.fillText('족보 도감', W / 2, 270);
  ctx.fillStyle = '#f4f5f7';
  ctx.font = '700 150px Archivo, sans-serif';
  ctx.fillText(`${hb.count}`, W / 2 - 40, 430);
  ctx.fillStyle = '#7d838b';
  ctx.font = '600 60px Archivo, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`/ ${hb.total}`, W / 2 + ctx.measureText(`${hb.count}`).width / 2 + 40, 430);
  ctx.textAlign = 'left';
  // One row per page: its name and a square per hand, filled where found.
  let y = 520;
  for (const p of hb.pages) {
    const list = hb.entries.filter(e => e.page === p.id);
    ctx.fillStyle = p.count === p.total ? '#fff6dc' : '#c4c9cf';
    ctx.font = '600 34px "Noto Sans KR", sans-serif';
    ctx.fillText(p.name, 120, y + 30);
    const size = 28, gap = 7, x0 = 360;
    list.forEach((e, i) => {
      const col = i % 17, row = Math.floor(i / 17);
      const x = x0 + col * (size + gap), yy = y + row * (size + gap);
      roundRect(ctx, x, yy, size, size, 6);
      if (e.got) { ctx.fillStyle = e.tier === 3 ? '#fff6dc' : '#f4f5f7'; ctx.fill(); }
      else { ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2; ctx.stroke(); }
    });
    y += 78 + Math.floor((list.length - 1) / 17) * (size + gap);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7d838b';
  ctx.font = '400 32px "Noto Sans KR", sans-serif';
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(`${nickname ? `${nickname} · ` : ''}${date}`, W / 2, 1200);
  ctx.fillText('가상 칩 · 현금 가치 없음', W / 2, 1250);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function shareBlob(blob, name, title, text) {
  if (!blob) return;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function shareEntry(entry, opts = {}) {
  const blob = await entryCard(entry, opts);
  const tally = opts.count != null ? ` 족보 도감 ${opts.count}/${opts.total}칸째!` : '';
  await shareBlob(blob, 'vegas-jokbo.png', `VEGAS 족보 · ${entry.name}`, `VEGAS ${PAGE_GAME[entry.page]}에서 ${withObject(entry.name)} 잡았어요!${tally}`);
}

export async function shareBook(hb, nickname = '') {
  const blob = await bookCard(hb, nickname);
  await shareBlob(blob, 'vegas-jokbo-book.png', 'VEGAS 족보 도감', `VEGAS 족보 도감 ${hb.count}/${hb.total}칸 채웠어요. 따라올 수 있으면 와 봐요!`);
}
