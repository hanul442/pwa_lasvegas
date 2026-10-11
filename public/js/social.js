// Friend duels and watching other players' tables.
// A duel is a week of play against one friend, scored on profit or wins; the winner takes the prize.
// Watching shows someone's blackjack hand as it stands: dealer's hole card stays face down.
import { api, errorMessage, playerId } from './api.js';
import { el, formatCH, sound } from './fx.js';
import { placeCards } from './cards.js';

const METRIC = { QUALIFIED_PROFIT: '수익', WINS: '승리' };
const PRIZE = 100_000_000;

function timeLeft(iso) {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const d = Math.floor(ms / 86_400_000), h = Math.floor(ms / 3_600_000) % 24, m = Math.floor(ms / 60_000) % 60;
  return d > 0 ? `${d}일 ${h}시간` : h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

const scoreText = (metric, v) => metric === 'WINS' ? `${v}승` : `${v > 0 ? '+' : ''}${formatCH(v)}`;

async function act(button, call, onChanged) {
  button.disabled = true;
  try { const out = await call(); sound.chip(); onChanged(out.state); }
  catch (e) { button.disabled = false; alert(errorMessage(e)); }
}

function button(label, cls, onClick) {
  const b = el('button', `pill-button ${cls}`, label);
  b.type = 'button';
  b.addEventListener('click', () => onClick(b));
  return b;
}

// Two bars that grow toward the leader; for profit a loss shows as an empty bar.
function scoreBars(c) {
  const me = c.score?.me ?? 0, them = c.score?.them ?? 0;
  const top = Math.max(1, Math.abs(me), Math.abs(them));
  const row = (who, v, mine) => `<div class="duel-score${mine ? ' is-me' : ''}"><span>${who}</span><span class="duel-bar"><i style="width:${Math.round((Math.max(0, v) / top) * 100)}%"></i></span><b>${scoreText(c.metric, v)}</b></div>`;
  return row('나', me, true) + row(c.counterpart?.nickname || '상대', them, false);
}

function duelItem(c, onChanged) {
  const li = el('li', `duel duel--${c.status.toLowerCase()}`);
  const name = c.counterpart?.nickname || '상대';
  const metric = METRIC[c.metric] || '';
  if (c.status === 'PENDING' && c.role === 'OPPONENT') {
    li.innerHTML = `<div class="duel-text"><strong>${name}님이 ${metric} 대결을 신청했어요</strong><small>7일 동안 ${metric}${c.metric === 'WINS' ? '가' : '이'} 많은 쪽이 ${formatCH(PRIZE)}를 받아요</small></div>`;
    const actions = el('div', 'duel-actions');
    actions.append(
      button('거절', '', b => act(b, () => api.challengeCancel(c.id), onChanged)),
      button('수락', 'pill-button--solid', b => act(b, () => api.challengeAccept(c.id), onChanged))
    );
    li.append(actions);
  } else if (c.status === 'PENDING') {
    li.innerHTML = `<div class="duel-text"><strong>${name}님에게 ${metric} 대결 신청</strong><small>상대가 수락하면 7일 동안 진행돼요</small></div>`;
    const actions = el('div', 'duel-actions');
    actions.append(button('취소', '', b => act(b, () => api.challengeCancel(c.id), onChanged)));
    li.append(actions);
  } else if (c.status === 'ACTIVE') {
    li.innerHTML = `<div class="duel-text"><strong>${name}님과 ${metric} 대결</strong><small>${timeLeft(c.endsAt)} 남음 · 상금 ${formatCH(PRIZE)}</small></div><div class="duel-scores">${scoreBars(c)}</div>`;
  } else {
    const verdict = c.status === 'COMPLETED' ? ({ ME: '승리', THEM: '패배', TIE: '무승부' }[c.winner]) : c.status === 'EXPIRED' ? '응답 없음' : '취소됨';
    const score = c.score ? ` · ${scoreText(c.metric, c.score.me)} 대 ${scoreText(c.metric, c.score.them)}` : '';
    li.innerHTML = `<div class="duel-text"><strong>${name}님과 ${metric} 대결</strong><small>${verdict}${score}</small></div><span class="duel-verdict${c.winner === 'ME' ? ' is-win' : ''}">${verdict}</span>`;
  }
  return li;
}

function challengeForm(state, onChanged) {
  const me = playerId();
  const others = (state.users || []).filter(u => u.id !== me);
  const form = el('div', 'duel-form');
  if (!others.length) { form.append(el('p', 'lounge-note', '대결할 친구가 아직 없어요.')); return form; }
  let pick = others[0].id, metric = 'QUALIFIED_PROFIT';
  const people = el('div', 'duel-people');
  const metrics = el('div', 'segmented segmented--two duel-metric');
  const draw = () => {
    people.replaceChildren(...others.map(u => {
      const b = el('button', `duel-person${u.id === pick ? ' is-active' : ''}`, `<span class="duel-avatar" aria-hidden="true">${u.accent || u.nickname.slice(0, 1)}</span><span>${u.nickname}</span>`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(u.id === pick));
      b.addEventListener('click', () => { pick = u.id; draw(); });
      return b;
    }));
    metrics.replaceChildren(...Object.entries(METRIC).map(([key, label]) => {
      const b = el('button', 'segment', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(key === metric));
      b.addEventListener('click', () => { metric = key; draw(); });
      return b;
    }));
  };
  draw();
  const send = button('대결 신청', 'pill-button--solid duel-send', b => act(b, () => api.challenge(pick, metric), onChanged));
  form.append(people, metrics, send);
  return form;
}

// The ranking screen's duel section.
export function renderDuels(root, state, onChanged) {
  const list = state?.socialCompetition?.challenges || [];
  const order = { PENDING: 0, ACTIVE: 1 };
  const open = list.filter(c => c.status in order).sort((a, b) => order[a.status] - order[b.status] || (a.role === 'OPPONENT' ? -1 : 1));
  const past = list.filter(c => !(c.status in order)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4);
  root.innerHTML = `<header class="lounge-head"><h2>친구 대결</h2><small>7일 승부 · 이기면 ${formatCH(PRIZE)}</small></header>`;
  if (open.length) {
    const ul = el('ul', 'duel-list');
    ul.append(...open.map(c => duelItem(c, onChanged)));
    root.append(ul);
  }
  root.append(challengeForm(state, onChanged));
  if (past.length) {
    root.append(el('h3', 'duel-sub', '지난 대결'));
    const ul = el('ul', 'duel-list duel-list--past');
    ul.append(...past.map(c => duelItem(c, onChanged)));
    root.append(ul);
  }
}

// Lobby notice when a friend has thrown down a challenge.
export function duelInviteBlock(state, onChanged) {
  const invites = (state?.socialCompetition?.challenges || []).filter(c => c.status === 'PENDING' && c.role === 'OPPONENT');
  if (!invites.length) return null;
  const box = el('section', 'lounge-block lounge-block--duel');
  box.innerHTML = '<header class="lounge-head"><h2>대결 신청이 왔어요</h2><small>7일 승부</small></header>';
  const ul = el('ul', 'duel-list');
  ul.append(...invites.slice(0, 2).map(c => duelItem(c, onChanged)));
  box.append(ul);
  return box;
}

// ---------- watching ----------
const tablesOf = state => (state?.socialCompetition?.spectating?.tables || []).filter(t => t.participant?.id !== playerId());

const floorName = (state, slug) => (state.floors || []).find(f => f.slug === slug)?.name || '';

export function watchBlock(state) {
  const tables = tablesOf(state);
  if (!tables.length) return null;
  const box = el('section', 'lounge-block lounge-block--watch');
  box.innerHTML = '<header class="lounge-head"><h2>지금 플레이 중</h2><small>옆 테이블 구경하기</small></header>';
  const ul = el('ul', 'watch-list');
  for (const t of tables.slice(0, 4)) {
    const li = el('li');
    const b = el('button', 'watch-item', `<span class="watch-live" aria-hidden="true"></span><span><strong>${t.participant.nickname}</strong><small>블랙잭${floorName(state, t.floor) ? ` · ${floorName(state, t.floor)}` : ''}</small></span><span class="watch-go">보기</span>`);
    b.type = 'button';
    b.addEventListener('click', () => openWatch(t.roundId, t.participant.nickname));
    li.append(b);
    ul.append(li);
  }
  box.append(ul);
  return box;
}

function handTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = c.slice(0, -1);
    if (r === 'A') { aces++; total += 11; } else total += ['K', 'Q', 'J'].includes(r) ? 10 : Number(r);
  }
  while (total > 21 && aces--) total -= 10;
  return total;
}

// A read-only view of one table, refreshed every couple of seconds until the round ends.
export function openWatch(roundId, nickname) {
  const sheet = el('div', 'watch-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', `${nickname}님의 테이블 보기`);
  sheet.innerHTML = `
    <div class="watch-felt">
      <header class="watch-head"><span class="watch-live" aria-hidden="true"></span><strong>${nickname}님의 블랙잭</strong><button type="button" class="pill-button" data-close>닫기</button></header>
      <p class="watch-label">딜러</p><div class="hand" data-dealer></div>
      <div class="watch-hands" data-hands></div>
      <p class="watch-note" data-note aria-live="polite">구경만 할 수 있어요. 딜러의 숨긴 카드는 보이지 않아요.</p>
    </div>`;
  document.body.append(sheet);
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  const dealer = sheet.querySelector('[data-dealer]');
  const hands = sheet.querySelector('[data-hands]');
  const note = sheet.querySelector('[data-note]');
  let last = '';
  const draw = t => {
    const key = JSON.stringify(t.gameState);
    if (key === last) return;
    last = key;
    placeCards(dealer, t.gameState.dealerCards);
    const list = t.gameState.hands || [{ cards: t.gameState.playerCards, doubled: t.gameState.doubled }];
    hands.replaceChildren(...list.map(h => {
      const wrap = el('div', 'watch-hand');
      const hand = el('div', 'hand');
      placeCards(hand, h.cards);
      const total = handTotal(h.cards);
      wrap.append(hand, el('span', `hand-total${total > 21 ? ' is-bust' : total === 21 ? ' is-21' : ''}`, `${total}${h.doubled ? ' · 더블' : ''}`));
      return wrap;
    }));
    sound.card();
  };
  let timer = null;
  const poll = async () => {
    try {
      const s = await api.state();
      const t = tablesOf(s).find(x => x.roundId === roundId);
      if (!t) { note.textContent = '이 판이 끝났어요.'; clearInterval(timer); return; }
      draw(t);
    } catch { note.textContent = '연결이 끊겼어요. 다시 시도하는 중…'; }
  };
  poll();
  timer = setInterval(() => { if (!document.hidden) poll(); }, 2000);
  const close = () => {
    clearInterval(timer);
    removeEventListener('keydown', onKey, true);
    sheet.classList.remove('is-open');
    setTimeout(() => sheet.remove(), 260);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.querySelector('[data-close]').addEventListener('click', close);
  sheet.querySelector('[data-close]').focus({ preventScroll: true });
}
