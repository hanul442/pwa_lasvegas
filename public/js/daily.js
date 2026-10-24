// 오늘의 한 판: the same ten blackjack deals for everyone today (lib/daily-blackjack.mjs).
// Points only, one go a day, one board, and a Wordle-style result to send to friends.
import { api, errorMessage } from './api.js';
import { dealCard, flipCard, placeCards } from './cards.js';
import { el, sound, haptic, wait, rollNumber } from './fx.js';
import { toast } from './notice.js';

const MOVES = [['hit', '히트'], ['stand', '스탠드'], ['double', '더블'], ['split', '스플릿']];
const RESULT = { win: '승', blackjack: '블랙잭', push: '무승부', lose: '패', bust: '버스트' };
const pts = n => `${Math.round(n).toLocaleString('ko-KR')}점`;
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');

export function dailyLink() {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('daily', '1');
  return url.href;
}

// The share sheet on phones (카카오톡), or the clipboard elsewhere.
async function shareResult(text) {
  const url = dailyLink();
  if (navigator.share) {
    try { await navigator.share({ title: '오늘의 한 판', text: `${text}\n`, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('결과를 복사했어요. 단톡방에 붙여 넣어 자랑해 보세요'); }
  catch { toast('복사하지 못했어요. 결과 화면을 캡처해 주세요'); }
}

// Opening ?daily=1 (a friend's shared result) goes straight to today's game after sign-in.
export function takeDailyLink() {
  const params = new URLSearchParams(location.search);
  if (params.get('daily') !== '1') return false;
  params.delete('daily');
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
  return true;
}

let open = null;
export function openDaily({ onClose = () => {} } = {}) {
  if (open) return;
  const root = el('section', 'daily');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '오늘의 한 판');
  root.innerHTML = `
    <header class="daily-top">
      <button class="sheet-close daily-close" type="button">닫기</button>
      <div class="daily-title"><span class="daily-kicker" data-d-no>오늘의 한 판</span><b class="daily-score" data-d-score>1,000점</b></div>
      <span class="daily-streak" data-d-streak></span>
    </header>
    <ol class="daily-track" data-d-track aria-label="10판 결과"></ol>
    <div class="daily-stage" data-d-stage></div>`;
  document.body.append(root);
  document.body.classList.add('daily-open');
  const stage = root.querySelector('[data-d-stage]');
  let view = null, busy = false, shown = null, table = null, showResult = false;

  const close = () => {
    removeEventListener('keydown', onKey, true);
    root.classList.remove('is-open');
    document.body.classList.remove('daily-open');
    setTimeout(() => root.remove(), 260);
    open = null;
    onClose();
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  root.querySelector('.daily-close').addEventListener('click', close);
  open = { close };
  requestAnimationFrame(() => root.classList.add('is-open'));

  function paintTop() {
    root.querySelector('[data-d-no]').textContent = `오늘의 한 판 #${view.no}`;
    const scoreEl = root.querySelector('[data-d-score]');
    const before = shown ?? view.start;
    if (before !== view.score) rollNumber(scoreEl, before, view.score, { format: pts });
    else scoreEl.textContent = pts(view.score);
    shown = view.score;
    root.querySelector('[data-d-streak]').textContent = view.streak > 1 ? `🔥 ${view.streak}일` : '';
    const marks = [...view.marks.matchAll(/\p{Extended_Pictographic}️?/gu)].map(m => m[0]);
    const track = root.querySelector('[data-d-track]');
    track.replaceChildren(...Array.from({ length: view.total }, (_, i) => {
      const li = el('li', `daily-slot${marks[i] ? ' is-done' : ''}${!marks[i] && i === view.hands.length - 1 && view.status === 'PLAYING' ? ' is-now' : ''}`, marks[i] || String(i + 1));
      li.setAttribute('aria-label', marks[i] ? `${i + 1}판 ${marks[i]}` : `${i + 1}판`);
      return li;
    }));
  }

  // ---------- before the first deal ----------
  function paintReady() {
    table = null;
    const box = el('div', 'daily-card daily-intro');
    const yt = view.yesterdayTop;
    box.innerHTML = `
      <p class="daily-eyebrow">#${view.no} · 오늘 ${view.board.players}명 참가</p>
      <h2>모두가 같은 카드로 10판</h2>
      <ul class="daily-rules">
        <li>오늘 하루, 모든 플레이어에게 똑같은 10판이 나와요.</li>
        <li>${pts(view.start)}에서 시작해 판마다 ${view.bet}점을 걸어요. 블랙잭은 +${view.bet * 1.5}점, 더블은 두 배.</li>
        <li>하루 한 번만 칠 수 있어요. 칩은 걸지 않아요.</li>
      </ul>
      ${yt ? `<p class="daily-note">어제 1등 · ${esc(yt.nickname)} ${pts(yt.score)}</p>` : ''}`;
    const go = el('button', 'home-cta daily-go', '첫 판 받기');
    go.type = 'button';
    go.addEventListener('click', () => send('start', go));
    box.append(go);
    stage.replaceChildren(box);
    stage.classList.add('is-centered');
  }

  // ---------- the table ----------
  function buildTable() {
    const felt = el('div', 'felt daily-felt');
    felt.innerHTML = `
      <div class="daily-dealer"><span class="daily-label">딜러 <b data-d-dtotal></b></span><div class="hand" data-d-dealer></div></div>
      <p class="daily-msg" data-d-msg aria-live="polite"></p>
      <div class="daily-hands" data-d-hands></div>
      <span class="daily-shoe" aria-hidden="true"></span>`;
    const bar = el('div', 'daily-actions');
    for (const [move, label] of MOVES) {
      const b = el('button', `action daily-act daily-act--${move}`, label);
      b.type = 'button';
      b.dataset.move = move;
      b.addEventListener('click', () => send(move, b));
      bar.append(b);
    }
    const next = el('button', 'action action--primary daily-next', '다음 판');
    next.type = 'button';
    next.hidden = true;
    next.addEventListener('click', () => {
      if (view.status === 'DONE') { showResult = true; paint(); }
      else send('next', next);
    });
    bar.append(next);
    stage.replaceChildren(felt, bar);
    stage.classList.remove('is-centered');
    table = { felt, bar, next, no: null, dealer: felt.querySelector('[data-d-dealer]'), hands: felt.querySelector('[data-d-hands]'), shoe: felt.querySelector('.daily-shoe') };
  }

  // Deals what is new since the last paint; a new hand or a split lays the cards out again.
  async function syncHand(box, cards) {
    const have = [...box.querySelectorAll('.card')];
    const same = have.length <= cards.length && have.every((n, i) => n.dataset.card === cards[i] || (n.dataset.card === 'HIDDEN' && cards[i] !== 'HIDDEN'));
    if (!same) { placeCards(box, cards); return; }
    for (let i = 0; i < cards.length; i++) {
      const node = have[i];
      if (node) { if (node.dataset.card === 'HIDDEN' && cards[i] !== 'HIDDEN') await flipCard(node, cards[i], { squeeze: true }); continue; }
      await dealCard(box, cards[i], table.shoe, { faceUp: cards[i] !== 'HIDDEN' });
    }
  }

  async function paintHand() {
    if (!table) buildTable();
    const h = view.hands[view.hands.length - 1];
    const fresh = table.no !== h.no;
    if (fresh) { table.no = h.no; table.dealer.replaceChildren(); table.hands.replaceChildren(); }
    const msg = table.felt.querySelector('[data-d-msg]');
    msg.textContent = fresh ? `${h.no}판 / ${view.total}` : msg.textContent;
    // The player's boxes: one, or two after a split.
    const boxes = [...table.hands.children];
    if (boxes.length !== h.hands.length) {
      table.hands.replaceChildren(...h.hands.map((_, i) => {
        const wrap = el('div', 'daily-hand');
        wrap.innerHTML = `<div class="hand"></div><span class="daily-label"><b></b></span><span class="daily-res" hidden></span>`;
        if (boxes[i]) wrap.querySelector('.hand').replaceChildren(...boxes[i].querySelectorAll('.card'));
        return wrap;
      }));
    }
    const wraps = [...table.hands.children];
    // Deal order on a new hand: player, dealer, player, dealer.
    if (fresh && h.hands.length === 1 && h.hands[0].cards.length >= 2) {
      const ph = wraps[0].querySelector('.hand');
      await dealCard(ph, h.hands[0].cards[0], table.shoe);
      await dealCard(table.dealer, h.dealer[0], table.shoe);
      await dealCard(ph, h.hands[0].cards[1], table.shoe);
      await dealCard(table.dealer, h.dealer[1], table.shoe, { faceUp: h.dealer[1] !== 'HIDDEN' });
    }
    for (let i = 0; i < h.hands.length; i++) await syncHand(wraps[i].querySelector('.hand'), h.hands[i].cards);
    if (h.over) { await wait(220); }
    await syncHand(table.dealer, h.dealer);
    table.felt.querySelector('[data-d-dtotal]').textContent = h.dealerTotal || '';
    h.hands.forEach((p, i) => {
      const w = wraps[i];
      w.classList.toggle('is-active', !h.over && h.hands.length > 1 && i === h.active);
      w.classList.toggle('is-waiting', !h.over && h.hands.length > 1 && i !== h.active);
      w.querySelector('.daily-label b').textContent = `${p.soft && p.total < 21 ? `${p.total - 10}/` : ''}${p.total}${p.doubled ? ' · 더블' : ''}`;
      const res = w.querySelector('.daily-res');
      res.hidden = !p.result;
      if (p.result) { res.textContent = `${RESULT[p.result]} ${signed(Math.round(p.net * view.bet))}`; res.className = `daily-res is-${p.net > 0 ? 'win' : p.net < 0 ? 'lose' : 'push'}`; }
    });
    if (h.over) {
      msg.textContent = h.points > 0 ? `${signed(h.points)}점` : h.points < 0 ? `${signed(h.points)}점` : '본전';
      msg.className = `daily-msg is-${h.points > 0 ? 'win' : h.points < 0 ? 'lose' : 'push'}`;
      if (h.points > 0) { sound.win(); haptic([10, 40, 10]); } else if (h.points < 0) sound.lose(); else sound.push();
    } else msg.className = 'daily-msg';
    for (const b of table.bar.querySelectorAll('.daily-act')) {
      b.hidden = h.over || (b.dataset.move === 'split' && !h.allowed.includes('split'));
      b.disabled = !h.allowed.includes(b.dataset.move);
    }
    table.next.hidden = !h.over;
    table.next.disabled = false;
    table.next.textContent = view.status === 'DONE' ? '결과 보기' : '다음 판';
    if (h.over) table.next.focus({ preventScroll: true });
  }

  // ---------- the day's result ----------
  function paintDone() {
    table = null;
    const b = view.board;
    const diff = view.score - view.book;
    const box = el('div', 'daily-card daily-done');
    box.innerHTML = `
      <p class="daily-eyebrow">#${view.no} 결과</p>
      <p class="daily-big">${pts(view.score)}</p>
      <p class="daily-marks" aria-label="판별 결과">${view.marks}</p>
      <dl class="daily-stats">
        <div><dt>순위</dt><dd>${b.me ? `${b.me.rank}등 <small>/ ${b.players}명</small>` : '—'}</dd></div>
        <div><dt>교과서 플레이</dt><dd>${pts(view.book)} <small>${diff === 0 ? '똑같아요' : diff > 0 ? `보다 ${diff}점 위` : `보다 ${-diff}점 아래`}</small></dd></div>
        <div><dt>연속 참가</dt><dd>${view.streak}일 <small>최고 ${view.bestStreak}일</small></dd></div>
      </dl>`;
    const share = el('button', 'home-cta daily-go daily-share', '단톡방에 자랑하기');
    share.type = 'button';
    share.addEventListener('click', () => shareResult(view.share));
    const pre = el('pre', 'daily-preview', esc(view.share || ''));
    box.append(share, pre);
    const board = el('section', 'daily-board');
    board.innerHTML = `<h3>오늘의 순위 <small>평균 ${b.average != null ? pts(b.average) : '—'}</small></h3>`;
    const ol = el('ol', 'daily-rows');
    for (const r of b.top) {
      const li = el('li', `daily-row${r.me ? ' is-me' : ''}`);
      li.innerHTML = `<span class="daily-rank">${r.rank}</span><span class="daily-name">${esc(r.nickname)}</span><span class="daily-rowmarks" aria-hidden="true">${r.marks}</span><b>${pts(r.score)}</b>`;
      ol.append(li);
    }
    board.append(ol);
    const next = el('p', 'daily-note', `다음 판은 자정에 열려요 · <span data-d-left>${left()}</span> 남음`);
    stage.replaceChildren(box, board, next);
    stage.classList.remove('is-centered');
  }
  const left = () => {
    const ms = Math.max(0, Date.parse(view.endsAt) - Date.now());
    const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60;
    return h ? `${h}시간 ${m}분` : `${m}분`;
  };
  const tick = setInterval(() => { if (!open) clearInterval(tick); const s = root.querySelector('[data-d-left]'); if (s && view) s.textContent = left(); }, 30_000);

  async function paint() {
    paintTop();
    if (view.status === 'READY') paintReady();
    else if (view.status === 'DONE' && (showResult || !table)) paintDone();
    else await paintHand();
  }

  async function send(move, button) {
    if (busy) return;
    busy = true;
    if (table) table.bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (button) button.disabled = true;
    try {
      view = await api.dailyPlay(move, view?.step ?? 0);
      await paint();
    } catch (err) {
      toast(errorMessage(err));
      try { view = await api.daily(); await paint(); } catch {}
    } finally {
      busy = false;
      if (button && view?.status === 'READY') button.disabled = false;
    }
  }

  stage.append(el('p', 'daily-note', '카드를 섞는 중…'));
  api.daily().then(v => { view = v; showResult = v.status === 'DONE'; return paint(); }).catch(err => { toast(errorMessage(err)); close(); });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

