// Big news as a banner that drops in from the top of the screen: someone's jackpot, a huge
// win, the season winner, a duel aimed at you (lib/news.mjs decides what counts). Polls
// quietly while the app is open; news from while you were away shows on your return.
import { api, playerId } from './api.js';
import { el, haptic } from './fx.js';

const POLL = 20_000;
const SHOW = 5200;
const SHOW_AT_TABLE = 3400;
const BACKLOG = 3; // at most this many banners for what happened while you were away
const keyFor = () => `vegas:news-at:${playerId()}`;

let timer = null, queue = [], showing = false, busy = false;

function cursor() {
  try { return Number(localStorage.getItem(keyFor())) || 0; } catch { return 0; }
}
function setCursor(ms) { try { localStorage.setItem(keyFor(), String(ms)); } catch {} }

async function poll() {
  if (busy || document.hidden) return;
  busy = true;
  try {
    // First time on this device: start from ten minutes ago rather than replaying history.
    const since = cursor() || Date.now() - 10 * 60_000;
    const out = await api.news(since);
    setCursor(out.now);
    const fresh = out.items.filter(n => !queue.some(q => q.id === n.id)).slice(0, BACKLOG).reverse();
    queue.push(...fresh);
    next();
  } catch {} finally { busy = false; }
}

function next() {
  if (showing || !queue.length) return;
  // 오늘의 한 판 fills the screen and its 닫기 and score sit where the banner drops: hold the news
  // until it closes.
  if (document.body.classList.contains('daily-open') || document.querySelector('.rp-player')) { clearTimeout(next.wait); next.wait = setTimeout(next, 1500); return; }
  showing = true;
  const n = queue.shift();
  const banner = el('div', `news-banner news-banner--${n.type.toLowerCase().replace(/_/g, '-')}`);
  banner.setAttribute('role', 'status');
  banner.innerHTML = '<i class="news-star" aria-hidden="true"></i><div class="news-text"><b></b><span></span></div>';
  banner.querySelector('b').textContent = n.title;
  banner.querySelector('span').textContent = n.body;
  // Someone else's moment: cheer or tease it right from the banner (동네방네, lib/brag.mjs).
  if (n.reactable) {
    const row = el('div', 'news-react');
    for (const [kind, emoji, label] of [['clap', '👏', '축하해요'], ['fire', '🔥', '대단해요'], ['lol', '😂', '웃겨요']]) {
      const b = el('button', 'news-react-btn', emoji);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('click', e => {
        e.stopPropagation();
        haptic(8);
        row.querySelectorAll('button').forEach(x => { x.disabled = true; });
        b.classList.add('is-on');
        api.feedReact(n.id, kind).catch(() => {});
        setTimeout(close, 450);
      });
      row.append(b);
    }
    banner.querySelector('.news-text').append(row);
  }
  document.body.append(banner);
  requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('is-open')));
  if (n.push) haptic(25);
  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    banner.classList.remove('is-open');
    setTimeout(() => { banner.remove(); showing = false; next(); }, 300);
  };
  banner.addEventListener('click', close);
  // Flick it up and away; at a table it also leaves sooner, since it covers the back button.
  let startY = null;
  banner.addEventListener('pointerdown', e => { startY = e.clientY; });
  banner.addEventListener('pointermove', e => { if (startY !== null && e.clientY - startY < -16) close(); });
  setTimeout(close, (document.body.classList.contains('game-mode') ? SHOW_AT_TABLE : SHOW) + (n.reactable ? 1800 : 0));
}

export function startNews() {
  clearInterval(timer);
  timer = setInterval(poll, POLL);
  setTimeout(poll, 2500);
}
export function stopNews() { clearInterval(timer); timer = null; queue = []; }

document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) poll(); });
