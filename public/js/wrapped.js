// VEGAS 랩드 (lib/wrapped.mjs): a month in story cards. Tap the right side (or swipe left) for the
// next card, the left side for the one before, hold to pause. The last card names the player's
// style for the month and makes a share image of the whole thing.
import { el, formatCH, sound, haptic, reducedMotion, rollNumber } from './fx.js';
import { gameName } from './names.js';
import { tierEmblem, tierName } from './rank.js';
import { loadLogo } from './bigwin.js';
import { shareImage } from './share.js';

const CARD_MS = 6500;
const TIER_COLOR = { iron: '#8a8f96', bronze: '#b07a4f', silver: '#d7dce3', gold: '#e2c27a', platinum: '#9fe0d8', emerald: '#5fd39a', diamond: '#9cc4ff', master: '#c9a0ff', grandmaster: '#ff6f91', legend: '#ff8a72' };

const monthOf = w => Number(String(w.season || '').slice(-2)) || new Date().getMonth() + 1;
// The season's name for the cards: "10~11월" for a two-month season, else "10월".
const seasonLabel = w => { const n = String(w.name || '').replace(' (프리시즌)', '').replace(/ 시즌$/, ''); return /월$/.test(n) ? n : `${monthOf(w)}월`; };
const pct = x => `${Math.round((x || 0) * 100)}%`;
const signed = n => `${n > 0 ? '+' : ''}${formatCH(n)}`;
const dateOf = iso => (iso ? new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }) : '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The month's style, first match wins: one title and a line to go with it.
export function persona(w) {
  const fav = w.games?.[0];
  if (w.best?.multiple >= 30) return { title: '한 방 사냥꾼', line: `한 판에 ${w.best.multiple}배. 다들 그 판 얘기만 해요.` };
  if (w.bestRun >= 8) return { title: '연승 기계', line: `${w.bestRun}연승. 딜러가 카드를 다시 셌어요.` };
  if (w.rounds >= 20 && w.winRate >= 0.55) return { title: '승률 괴물', line: `${pct(w.winRate)} 승률. 하우스가 긴장했어요.` };
  if (fav && w.rounds >= 10 && fav.share >= 0.7) return { title: `${gameName(fav.game)} 외길`, line: `${pct(fav.share)}를 ${gameName(fav.game)}에 바쳤어요.` };
  if (w.gamesPlayed >= 6) return { title: '올라운더', line: `${w.gamesPlayed}가지 게임을 다 건드려 봤어요.` };
  if (w.pnl < 0 && w.rounds >= 30) return { title: '칩 기부 천사', line: '카지노가 고마워하고 있어요.' };
  if (w.pnl > 0) return { title: '조용한 승부사', line: '티 안 나게 따 갔어요.' };
  return { title: '라스베가스 단골', line: '그래도 또 앉았죠.' };
}

function cards(w, nickname) {
  const m = seasonLabel(w);
  const fav = w.games?.[0];
  const p = persona(w);
  const out = [];
  out.push({ key: 'intro', html: `
    <span class="wr-kicker">VEGAS 랩드</span>
    <h2 class="wr-huge">${m}</h2>
    <p class="wr-lead">${esc(nickname)}님의 이번 시즌을<br>정리해 봤어요</p>
    <small class="wr-foot">${w.live ? `${dateOf(new Date().toISOString())}까지 · 아직 진행 중` : `${String(w.name || '').replace(' (프리시즌)', '')} 마감`}</small>` });
  out.push({ key: 'rounds', html: `
    <span class="wr-kicker">이번 시즌 플레이</span>
    <h2 class="wr-huge"><span data-roll="${w.rounds}">${w.rounds.toLocaleString('ko-KR')}</span><small>판</small></h2>
    <p class="wr-lead">${w.days ? `${w.days}일 동안 테이블에 앉았어요` : '테이블에 이만큼 앉았어요'}</p>
    <dl class="wr-stats">
      <div><dt>승률</dt><dd>${pct(w.winRate)}</dd></div>
      <div><dt>이긴 판</dt><dd>${w.wins.toLocaleString('ko-KR')}</dd></div>
      <div><dt>총 베팅</dt><dd>${formatCH(w.wagered)}</dd></div>
    </dl>` });
  if (fav) {
    const top = (w.games || []).slice(0, 3);
    out.push({ key: 'fav', html: `
      <span class="wr-kicker">가장 많이 한 게임</span>
      <h2 class="wr-big">${gameName(fav.game)}</h2>
      <p class="wr-lead">전체의 ${pct(fav.share)} · ${fav.rounds.toLocaleString('ko-KR')}판</p>
      <ol class="wr-bars">${top.map((g, i) => `<li><span>${i + 1}</span><b>${gameName(g.game)}</b><i style="--w:${Math.max(4, Math.round(g.share * 100))}%"></i><small>${g.rounds}판 · ${signed(g.pnl)}</small></li>`).join('')}</ol>` });
  }
  if (w.best) out.push({ key: 'best', html: `
    <span class="wr-kicker">인생 한 판</span>
    <h2 class="wr-big wr-pos">+${formatCH(w.best.pnl)}</h2>
    <p class="wr-lead">${gameName(w.best.game)}${w.best.multiple >= 2 ? ` · 건 돈의 ${w.best.multiple}배` : ''}</p>
    ${w.best.at ? `<small class="wr-foot">${dateOf(w.best.at)}의 그 판</small>` : ''}` });
  if (w.worst) out.push({ key: 'worst', html: `
    <span class="wr-kicker">눈물의 한 판</span>
    <h2 class="wr-big wr-neg">${formatCH(w.worst.pnl)}</h2>
    <p class="wr-lead">${gameName(w.worst.game)}에서 한 번에</p>
    <small class="wr-foot">${w.pnl >= 0 ? '그래도 이번 시즌은 남겼어요' : '그래도 다음 판은 또 오죠'}</small>` });
  out.push({ key: 'tier', tier: w.tier, html: `
    <span class="wr-kicker">${w.rp != null ? '이번 시즌 RP' : '이번 시즌 최고 순자산'}</span>
    <h2 class="wr-big">${w.rp != null ? `${w.rp}<small> RP</small>` : formatCH(w.peak)}</h2>
    <div class="wr-tier">${tierEmblem(w.tier, { size: 96 })}<b>${tierName(w.tier)}</b></div>
    <p class="wr-lead">${w.rank && w.of ? `${w.of.toLocaleString('ko-KR')}명 중 ${w.rank}위${w.live ? ' (지금)' : ''}` : ''}</p>
    ${w.bestRun >= 3 ? `<small class="wr-foot">최장 ${w.bestRun}연승</small>` : ''}` });
  out.push({ key: 'end', html: `
    <span class="wr-kicker">${m}의 나는</span>
    <h2 class="wr-big">${esc(p.title)}</h2>
    <p class="wr-lead">${esc(p.line)}</p>
    <dl class="wr-stats">
      <div><dt>판 수</dt><dd>${w.rounds.toLocaleString('ko-KR')}</dd></div>
      <div><dt>손익</dt><dd class="${w.pnl >= 0 ? 'wr-pos' : 'wr-neg'}">${signed(w.pnl)}</dd></div>
      <div><dt>티어</dt><dd>${tierName(w.tier)}</dd></div>
    </dl>
    <div class="wr-actions">
      <button type="button" class="pill-button pill-button--solid" data-wr-share>동네방네 자랑하기</button>
      <button type="button" class="pill-button" data-wr-again>처음부터</button>
    </div>` });
  return out;
}

// Opens the story. w: a month from state.wrapped (live or history).
export function openWrapped(w, { nickname = '' } = {}) {
  if (!w?.rounds) return;
  const list = cards(w, nickname);
  const node = el('div', 'wrapped');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.tabIndex = -1;
  node.setAttribute('aria-label', `VEGAS 랩드 ${seasonLabel(w)}`);
  node.innerHTML = `
    <div class="wr-progress" aria-hidden="true">${list.map(() => '<span><i></i></span>').join('')}</div>
    <button type="button" class="wr-close" aria-label="닫기">✕</button>
    <div class="wr-stage" aria-live="polite"></div>
    <p class="wr-hint" aria-hidden="true">탭해서 넘기기</p>`;
  document.body.append(node);
  const stage = node.querySelector('.wr-stage');
  const bars = [...node.querySelectorAll('.wr-progress i')];
  let i = 0, timer = 0, startedAt = 0, left = CARD_MS, paused = false, closed = false;

  const tick = () => {
    clearTimeout(timer);
    if (paused || i >= list.length - 1) return;
    startedAt = Date.now();
    timer = setTimeout(() => go(i + 1), left);
  };
  const paintBars = () => bars.forEach((b, k) => {
    b.style.animation = 'none';
    b.style.width = k < i ? '100%' : '0%';
    if (k === i) {
      if (i === list.length - 1) b.style.width = '100%';
      else { void b.offsetWidth; b.style.animation = `wr-fill ${CARD_MS}ms linear forwards`; b.style.animationPlayState = paused ? 'paused' : 'running'; }
    }
  });
  function show(k) {
    const c = list[k];
    const card = el('section', `wr-card wr-card--${c.key}`);
    if (c.tier) card.style.setProperty('--wr-tint', TIER_COLOR[c.tier] || '#fff');
    card.innerHTML = c.html;
    stage.replaceChildren(card);
    requestAnimationFrame(() => card.classList.add('is-in'));
    const roll = card.querySelector('[data-roll]');
    if (roll && !reducedMotion()) rollNumber(roll, 0, Number(roll.dataset.roll), { duration: 900, format: n => Math.round(n).toLocaleString('ko-KR') });
    card.querySelector('[data-wr-share]')?.addEventListener('click', async e => {
      e.stopPropagation();
      const b = e.currentTarget; b.disabled = true;
      await shareWrapped(w, nickname).catch(() => {});
      b.disabled = false;
    });
    card.querySelector('[data-wr-again]')?.addEventListener('click', e => { e.stopPropagation(); go(0); });
    node.querySelector('.wr-hint').hidden = k > 0;
    if (k === list.length - 1) { sound.win?.(); haptic([30, 40, 60]); card.querySelector('[data-wr-share]')?.focus({ preventScroll: true }); }
  }
  function go(k) {
    if (closed) return;
    if (k >= list.length) { close(); return; }
    i = Math.max(0, k);
    left = CARD_MS;
    sound.tick?.();
    show(i);
    paintBars();
    tick();
  }
  const pause = on => {
    if (paused === on) return;
    paused = on;
    if (on) { clearTimeout(timer); left = Math.max(400, left - (Date.now() - startedAt)); }
    const b = bars[i]; if (b) b.style.animationPlayState = on ? 'paused' : 'running';
    if (!on) tick();
  };
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVis);
    node.classList.remove('is-open');
    setTimeout(() => node.remove(), 350);
  }
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  };
  addEventListener('keydown', onKey, true);
  node.querySelector('.wr-close').addEventListener('click', e => { e.stopPropagation(); close(); });

  // Tap left / right, swipe, or hold to pause (a hold doesn't count as a tap).
  let down = null;
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    down = { x: e.clientX, y: e.clientY, t: Date.now() };
    pause(true);
  });
  const up = e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, held = Date.now() - down.t;
    down = null;
    pause(false);
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? i + 1 : i - 1); return; }
    if (held > 350 || Math.abs(dy) > 40) return;
    const r = stage.getBoundingClientRect();
    go(e.clientX - r.left < r.width / 3 ? i - 1 : i + 1);
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', () => { down = null; pause(false); });
  const onVis = () => pause(document.hidden);
  document.addEventListener('visibilitychange', onVis);

  requestAnimationFrame(() => node.classList.add('is-open'));
  go(0);
  node.focus({ preventScroll: true });
}

// ---------- share image ----------
function star(ctx, x, y, r, color) {
  const pts = [[0, -1], [0.2, -0.2], [1, 0], [0.2, 0.2], [0, 1], [-0.2, 0.2], [-1, 0], [-0.2, -0.2]];
  ctx.beginPath();
  pts.forEach(([px, py], k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, x + px * r, y + py * r));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function hexagon(ctx, x, y, r, face, edge) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k - Math.PI / 2; (k ? ctx.lineTo : ctx.moveTo).call(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
  ctx.fillStyle = face; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = edge; ctx.stroke();
}
function fit(ctx, text, max, weight, size, family) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > max && s > 24) { s -= 4; ctx.font = `${weight} ${s}px ${family}`; }
}
const SANS = 'Archivo, "Noto Sans KR", sans-serif';
const KR = '"Noto Sans KR", Archivo, sans-serif';

export async function wrappedCard(w, nickname = '') {
  const W = 1080, H = 1920;
  try { await document.fonts?.ready; } catch {}
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const tint = TIER_COLOR[w.tier] || '#f4f5f7';
  const bg = ctx.createRadialGradient(W / 2, 520, 40, W / 2, 620, H * 0.8);
  bg.addColorStop(0, '#20252c'); bg.addColorStop(1, '#0a0b0d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);
  const logo = await loadLogo();
  if (logo) ctx.drawImage(logo, W / 2 - 160, 120, 320, 68);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b3b8bf';
  ctx.font = `600 38px ${KR}`;
  ctx.fillText(`VEGAS 랩드 · ${seasonLabel(w)}${w.live ? ' (진행 중)' : ''}`, W / 2, 280);
  ctx.fillStyle = '#f4f5f7';
  fit(ctx, nickname, W - 200, 700, 72, KR);
  ctx.fillText(nickname, W / 2, 380);

  // The style of the month, under the tier's hexagon.
  hexagon(ctx, W / 2, 650, 140, '#14171b', tint);
  star(ctx, W / 2, 650, 66, '#fff6dc');
  const p = persona(w);
  ctx.fillStyle = '#f4f5f7';
  fit(ctx, p.title, W - 160, 700, 108, `${SANS}`);
  ctx.fillText(p.title, W / 2, 940);
  ctx.fillStyle = '#c4c9cf';
  fit(ctx, p.line, W - 180, 500, 40, KR);
  ctx.fillText(p.line, W / 2, 1010);

  // Six numbers in two columns.
  const fav = w.games?.[0];
  const cells = [
    ['판 수', `${w.rounds.toLocaleString('ko-KR')}판`],
    ['승률', pct(w.winRate)],
    ['가장 많이 한 게임', fav ? gameName(fav.game) : '-'],
    ['인생 한 판', w.best ? `+${formatCH(w.best.pnl)}` : '-'],
    w.rp != null ? ['시즌 RP', `${w.rp} RP`] : ['최고 순자산', formatCH(w.peak)],
    ['티어', `${tierName(w.tier)}${w.rank && w.of ? ` · ${w.rank}위` : ''}`]
  ];
  const top = 1130, rowH = 220, colW = (W - 200) / 2;
  cells.forEach(([label, value], k) => {
    const cx = 100 + (k % 2) * colW + colW / 2, cy = top + Math.floor(k / 2) * rowH;
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2;
    if (k % 2 === 0) { ctx.beginPath(); ctx.moveTo(100, cy - 20); ctx.lineTo(W - 100, cy - 20); ctx.stroke(); }
    ctx.fillStyle = '#9aa0a8';
    ctx.font = `500 34px ${KR}`;
    ctx.fillText(label, cx, cy + 40);
    ctx.fillStyle = k === 3 ? '#fff6dc' : k === 5 ? tint : '#f4f5f7';
    fit(ctx, value, colW - 40, 700, 70, SANS);
    ctx.fillText(value, cx, cy + 130);
  });
  ctx.fillStyle = '#7d838b';
  ctx.font = `400 32px ${KR}`;
  ctx.fillText('가상 칩 · 현금 가치 없음', W / 2, H - 100);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// Out through the shared 자랑하기 path (js/share.js): the story image, a line, and the invite link
// with ?from=me, so a friend who taps it lands in VEGAS with the invite reward counted.
export async function shareWrapped(w, nickname = '') {
  const blob = await wrappedCard(w, nickname);
  if (!blob) return;
  const m = seasonLabel(w);
  const p = persona(w);
  const text = `VEGAS ${m} 결산: ${p.title} · ${tierName(w.tier)} · ${w.rounds.toLocaleString('ko-KR')}판`;
  await shareImage({ blob, filename: `vegas-wrapped-${String(w.season || m).replace('rank-', '')}.png`, title: `VEGAS 랩드 ${m}`, text, ...(nickname ? { nickname } : {}) });
}

// The profile's row: this month so far, then the months gone by.
export function wrappedBlock(state) {
  const wr = state.wrapped;
  const months = [...(wr?.live ? [wr.live] : []), ...(wr?.history || []).filter(h => h.rounds)];
  if (!months.length) return null;
  const box = el('section', 'wr-list');
  box.innerHTML = `<h2 class="sub-head">VEGAS 랩드 <small>시즌 결산 카드</small></h2>
    <ul>${months.map((m, k) => `<li><button type="button" class="wr-row" data-k="${k}">
      ${tierEmblem(m.tier, { size: 34, label: false })}
      <span><b>${seasonLabel(m)} 결산${m.live ? ' <em>진행 중</em>' : ''}</b><small>${m.rounds.toLocaleString('ko-KR')}판 · ${persona(m).title} · ${tierName(m.tier)}</small></span>
      <span class="wr-row-go" aria-hidden="true">→</span></button></li>`).join('')}</ul>`;
  box.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => openWrapped(months[Number(b.dataset.k)], { nickname: state.user?.nickname })));
  return box;
}

// The season results moment: the month just closed, if this player played it.
export const closedWrapped = (state, seasonId) => (state.wrapped?.history || []).find(h => h.season === seasonId && h.rounds) || null;
