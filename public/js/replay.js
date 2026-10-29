// 큰 판 다시보기: the hands worth seeing again. When a round ends with a big win or a big loss,
// the cards still face up on the felt are written down (just their names, a few hundred bytes),
// and the profile keeps the list. Playing one back deals those cards again on a small felt, one
// hand after another, and rolls the amount up the way the table did.
// Kept on this phone in localStorage, per player: nothing is sent, nothing scans the ledger.
import { el, sound, haptic, rollNumber, formatMoney, animate, ms, wait, reducedMotion } from './fx.js';
import { createCard, flipCard } from './cards.js';
import { createHwatu, flipHwatu, hwatu } from './hwatu.js';
import { playerId } from './api.js';
import { BIG_WIN_LEVELS, shareWin } from './bigwin.js';

// Measured in the table's minimum bet, like the big-win bar (bigwin.js): a win counts at 25 bets
// (and the big-win screen's own rule of double the stake), a loss at 25 bets gone in one hand.
export const BIG_LOSS_AT = 25;
export const KEEP = 24;     // replays kept
export const PINNED = 4;    // the biggest wins and losses are never pushed out by newer ones
const MAX_GROUPS = 8, MAX_CARDS = 20;

const key = () => `vegas:replays:${playerId() || 'guest'}`;
export function loadReplays() {
  try { const list = JSON.parse(localStorage.getItem(key()) || '[]'); return Array.isArray(list) ? list.filter(r => r && r.groups) : []; } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(key(), JSON.stringify(list)); } catch {}
}

// Newest first. Past KEEP, the oldest goes, unless it is one of the biggest wins or losses.
export function keepList(list) {
  if (list.length <= KEEP) return list;
  const top = new Set([
    ...list.filter(r => r.net > 0).sort((a, b) => b.net - a.net).slice(0, PINNED),
    ...list.filter(r => r.net < 0).sort((a, b) => a.net - b.net).slice(0, PINNED)
  ]);
  const out = [...list];
  for (let i = out.length - 1; i >= 0 && out.length > KEEP; i--) if (!top.has(out[i])) out.splice(i, 1);
  return out.slice(0, KEEP);
}

export const isBigLoss = (net, min) => net < 0 && min > 0 && -net >= BIG_LOSS_AT * min;

// ---------- reading the felt ----------
// Who a group of cards belongs to. The nearest of these around a card names its group.
const OWNERS = '.bj-dealer, .hand-wrap, [data-side], [data-caps], [data-board], [data-hand], [data-opp-hand], [data-seat]';
function ownerOf(card, root) {
  const o = card.closest(OWNERS);
  return o && root.contains(o) ? o : card.parentElement;
}
const text = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
function ownerLabel(o) {
  if (o.matches('.bj-dealer')) return { who: '딜러', note: text(o.querySelector('.hand-total')) };
  if (o.matches('.hand-wrap')) return { who: (n => (n ? `박스 ${n}` : '나'))(text(o.closest('.bj-spot')?.querySelector('.bet-circle-label'))), note: [text(o.querySelector('.hand-total')), text(o.querySelector('.hand-result'))].filter(Boolean).join(' · ') };
  if (o.matches('[data-side]')) return { who: text(o.querySelector('h3')) || o.dataset.side, note: text(o.querySelector('[data-score]')) };
  if (o.matches('[data-caps]')) return { who: o.dataset.caps === '0' ? '내가 먹은 패' : '상대가 먹은 패' };
  if (o.matches('[data-board]')) return { who: o.getAttribute('aria-label') || '바닥' };
  if (o.matches('[data-hand]')) return { who: '내 패' };
  if (o.matches('[data-opp-hand]')) return { who: '상대 패' };
  const me = o.matches('.pk-seat--hero, .sd-seat--me') || o.dataset.seat === '0' && !o.matches('.pk-seat');
  const name = me ? '나' : text(o.querySelector('.sd-who, .pk-plate [data-name], .mg-name')) || '상대';
  return { who: name, note: text(o.querySelector('.sd-hand-name, [data-hand-name]')) };
}

// The face-up cards on the felt, grouped by whose they are, in the order the felt shows them.
// AI players at the blackjack table are left out: the replay is the dealer against me.
export function readFelt(root) {
  if (!root) return [];
  const groups = new Map();
  root.querySelectorAll('.card[data-card], .hw[data-card]').forEach(card => {
    if (card.closest('.bj-seat-hand, .bigwin, .jk-moment')) return;
    const id = card.dataset.card;
    const hw = card.classList.contains('hw');
    if (!id || id === 'HIDDEN' || !card.classList.contains('is-faceup')) return;
    if (hw && !hwatu(id)) return;
    const o = ownerOf(card, root);
    if (!groups.has(o)) groups.set(o, { ...ownerLabel(o), kind: hw ? 'hw' : 'card', cards: [] });
    groups.get(o).cards.push(id);
  });
  return [...groups.values()].slice(0, MAX_GROUPS).map(g => {
    const out = { who: g.who || '', kind: g.kind, cards: g.cards.slice(-MAX_CARDS) };
    if (g.note) out.note = g.note.slice(0, 40);
    return out;
  });
}

// Writes one replay down and returns it.
export function recordReplay({ game, gameTitle, tier, felt, net, staked = 0, min = 0, label = '', title = '', groups }) {
  if (!net) return null;
  const entry = { at: Date.now(), game, gameTitle, tier, felt, net, staked, min, level: levelFor(net, min), label: String(label || '').slice(0, 60), title: String(title || '').slice(0, 30), groups: groups || [] };
  save(keepList([entry, ...loadReplays()]));
  return entry;
}
const levelFor = (net, min) => (net > 0 ? BIG_WIN_LEVELS.find(l => min > 0 && net >= l.at * min)?.level || 1 : 0);

// The same round seen twice (the round's result and its big-win screen) becomes one replay:
// fills in what the second look adds. `exact` carries the round's own net, which wins.
export function updateReplay(entry, { net, staked, label, title, groups, exact = false }) {
  const list = loadReplays();
  const r = list.find(x => x.at === entry.at && x.game === entry.game);
  if (!r) return null;
  if (exact && net) { r.net = net; r.staked = staked ?? r.staked; r.level = levelFor(net, r.min); }
  if (label && (exact || !r.label)) r.label = String(label).slice(0, 60);
  if (title && !r.title) r.title = String(title).slice(0, 30);
  const count = gs => (gs || []).reduce((n, g) => n + g.cards.length, 0);
  if (count(groups) > count(r.groups)) r.groups = groups;
  save(list);
  return r;
}

// ---------- the profile block ----------
const when = at => new Date(at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const headline = r => r.title || r.label || (r.net > 0 ? '대박' : '큰 손실');
const tag = r => (r.net > 0 ? (BIG_WIN_LEVELS.find(l => l.level === r.level)?.label || 'BIG WIN') : 'BIG LOSS');

export function replayBlock(state) {
  const box = el('div', 'rp-list');
  const paint = () => {
    const list = loadReplays();
    if (!list.length) {
      box.innerHTML = `<p class="lounge-note rp-empty">한 판에 최소 베팅의 25배 넘게 따거나 잃으면, 그 판의 카드가 여기에 남아요. 언제든 다시 돌려 볼 수 있어요.</p>`;
      return;
    }
    const best = Math.max(0, ...list.map(r => r.net));
    const worst = Math.min(0, ...list.map(r => r.net));
    box.replaceChildren(...list.map(r => {
      const b = el('button', `rp-row ${r.net > 0 ? 'is-win' : 'is-loss'}`);
      b.type = 'button';
      const crown = r.net === best && best > 0 ? '<i class="rp-crown">최고</i>' : r.net === worst && worst < 0 ? '<i class="rp-crown rp-crown--low">최악</i>' : '';
      b.innerHTML = `<span class="rp-play" aria-hidden="true"></span>
        <span class="rp-text"><small>${tag(r)} · ${r.gameTitle || ''}${r.tier ? ` · ${r.tier}` : ''}</small><b>${headline(r)}${crown}</b><small class="rp-when">${when(r.at)}</small></span>
        <strong class="rp-amount">${r.net > 0 ? '+' : '-'}${formatMoney(Math.abs(r.net))}</strong>`;
      b.setAttribute('aria-label', `${headline(r)}, ${r.net > 0 ? '벌었어요' : '잃었어요'} ${formatMoney(Math.abs(r.net))}, ${when(r.at)} 다시보기`);
      b.addEventListener('click', () => playReplay(r, { nickname: state?.user?.nickname || '' }));
      return b;
    }));
  };
  paint();
  return box;
}

// ---------- playing one back ----------
export function playReplay(r, { nickname = '' } = {}) {
  document.querySelector('.rp-player')?.remove();
  const win = r.net > 0;
  const node = el('section', `rp-player ${win ? 'is-win' : 'is-loss'}`);
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-label', `${headline(r)} 다시보기`);
  node.innerHTML = `
    <header class="rp-head">
      <div><p class="lounge-eyebrow">REPLAY · ${when(r.at)}</p><h2>${r.gameTitle || ''}${r.tier ? ` <small>${r.tier}</small>` : ''}</h2></div>
      <button type="button" class="jk-close" aria-label="닫기" data-close></button>
    </header>
    <div class="rp-felt felt${r.felt ? ` felt--${r.felt}` : ''}"><div class="rp-groups" data-groups></div>
    </div>
    <div class="rp-outcome" data-outcome>
      <p class="rp-tag" data-tag></p>
      <h3 class="rp-title" data-title></h3>
      <strong class="rp-money"><span data-amount></span></strong>
      ${r.staked > 0 && win && r.net >= r.staked * 2 ? `<p class="rp-sub">판돈의 ${Math.floor(r.net / r.staked)}배</p>` : !win && r.min > 0 ? `<p class="rp-sub">최소 베팅 ${Math.round(-r.net / r.min)}판어치</p>` : ''}
    </div>
    <footer class="rp-foot">
      <button type="button" class="pill-button" data-again>다시 재생</button>
      ${win ? '<button type="button" class="pill-button pill-button--solid" data-share>자랑하기</button>' : ''}
    </footer>`;
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('is-open'));

  let run = 0;
  const groupsEl = node.querySelector('[data-groups]');
  const outcome = node.querySelector('[data-outcome]');
  async function play() {
    const id = ++run;
    const live = () => id === run && node.isConnected;
    outcome.classList.remove('is-shown');
    node.querySelector('[data-tag]').textContent = '';
    node.querySelector('[data-title]').textContent = '';
    node.querySelector('[data-amount]').textContent = '';
    const rows = r.groups.map(g => {
      const row = el('div', `rp-group rp-group--${g.kind}${g.cards.length > 8 ? ' is-many' : ''}`);
      row.innerHTML = `<p class="rp-who"><b></b><small></small></p><div class="${g.kind === 'hw' ? 'rp-hw' : 'hand rp-hand'}"></div>`;
      row.querySelector('b').textContent = g.who;
      row.querySelector('small').textContent = '';
      return { row, g, hand: row.lastElementChild };
    });
    groupsEl.replaceChildren(...rows.map(x => x.row));
    if (!rows.length) groupsEl.append(el('p', 'rp-nocards', r.label || ''));
    sound.shuffle?.();
    await wait(280);
    // Dealt face down one by one, then turned over a group at a time: the table's own rhythm.
    for (const { g, hand, row } of rows) {
      if (!live()) return;
      const nodes = g.cards.map(c => (g.kind === 'hw' ? createHwatu(c, { faceUp: false }) : createCard(c, { faceUp: false })));
      for (const n of nodes) {
        if (!live()) return;
        hand.append(n);
        if (!reducedMotion()) animate(n, [{ transform: 'translateY(-40px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.2,.8,.3,1)' });
        sound.card();
        await wait(g.cards.length > 8 ? 45 : 110);
      }
      await wait(120);
      await Promise.all(nodes.map((n, i) => wait(i * 60).then(() => (live() ? (g.kind === 'hw' ? flipHwatu(n, g.cards[i]) : flipCard(n, g.cards[i])) : null))));
      if (!live()) return;
      if (g.note) { const s = row.querySelector('small'); s.textContent = g.note; animate(s, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 }); }
      await wait(260);
    }
    if (!live()) return;
    await wait(rows.length ? 380 : 120);
    if (!live()) return;
    node.querySelector('[data-tag]').textContent = tag(r);
    node.querySelector('[data-title]').textContent = headline(r);
    outcome.classList.add('is-shown');
    if (win) { sound.win(); haptic([30, 50, 30, 50, 90]); } else { sound.lose(); haptic([60, 40, 120]); }
    await rollNumber(node.querySelector('[data-amount]'), 0, Math.abs(r.net), { duration: 900 + Math.min(3, r.level || 1) * 300, format: v => `${win ? '+' : '-'}${formatMoney(v)}` });
  }
  play();

  const close = () => {
    run++;
    removeEventListener('keydown', onKey, true);
    node.classList.remove('is-open');
    setTimeout(() => node.remove(), ms(300));
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-close]').addEventListener('click', close);
  node.querySelector('[data-again]').addEventListener('click', () => play());
  node.querySelector('[data-share]')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    await shareWin({ title: headline(r), amount: r.net, game: r.gameTitle, nickname, label: tag(r) }).catch(() => {});
    e.currentTarget.disabled = false;
  });
  node.querySelector('[data-close]').focus({ preventScroll: true });
  return node;
}
