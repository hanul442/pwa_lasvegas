// 동네방네 자랑하기: every brag goes out the same way. The phone's share sheet (카카오톡, 인스타,
// 문자) gets the card image, a line to brag with, and a link back into VEGAS that says who sent
// it (?from=nickname). Where a share sheet can't take images, the card is saved and the line
// and link are copied, ready to paste.
import { el, sound } from './fx.js';
import { toast } from './notice.js';

// Who is bragging: app.js keeps this in step with the signed-in player.
let myName = '';
export function setBragName(name) { myName = String(name || ''); }
export const bragName = () => myName;

// params: extra query to open a screen on arrival, e.g. { daily: '1' } for 오늘의 한 판.
export function appLink(nickname = myName, params = null) {
  const url = new URL('/', location.origin);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  if (nickname) url.searchParams.set('from', nickname);
  return url.href;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// blob: the card PNG (or null for a text-only brag). Resolves to 'shared', 'saved' or 'cancelled'.
export async function shareImage({ blob, filename = 'vegas.png', title = 'VEGAS', text = '', nickname = myName, params = null }) {
  const url = appLink(nickname, params);
  const line = `${text}\n같이 해요 → ${url}`;
  const file = blob ? new File([blob], filename, { type: 'image/png' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    // Some apps drop the url field when a file rides along, so the link also goes in the text.
    try { await navigator.share({ files: [file], title, text: line }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  if (!file && navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  if (file) download(file, filename);
  let copied = false;
  try { await navigator.clipboard.writeText(line); copied = true; } catch {}
  toast(file
    ? (copied ? '자랑 카드를 저장하고 문구와 링크를 복사했어요. 카톡에 붙여 넣어 보세요' : '자랑 카드를 저장했어요')
    : (copied ? '자랑 문구와 링크를 복사했어요' : '공유할 수 없는 브라우저예요'), { duration: 4200 });
  return 'saved';
}

// The button every brag moment carries.
export function bragButton(onShare, label = '동네방네 자랑하기') {
  const b = el('button', 'pill-button pill-button--solid brag-button', label);
  b.type = 'button';
  b.addEventListener('click', async e => {
    e.stopPropagation();
    sound.tick();
    b.disabled = true;
    try { await onShare(); } catch {} finally { b.disabled = false; }
  });
  return b;
}

// ---------- the card ----------
let logoImage = null;
export function loadLogo() {
  if (logoImage) return logoImage;
  logoImage = new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'logo.svg';
  });
  return logoImage;
}

export function drawStar(ctx, x, y, r, color) {
  // The VEGAS four-point star, same proportions as --star-shape.
  const pts = [[0, -1], [0.2, -0.2], [1, 0], [0.2, 0.2], [0, 1], [-0.2, 0.2], [-1, 0], [-0.2, -0.2]];
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + px * r, y + py * r));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Same metals as .tier-emblem--* in lounge.css.
export const TIER_METAL = {
  iron: ['#8a8f96', '#2e3135', '#c9cdd2'], bronze: ['#b07a4f', '#5a3a24', '#f3d9c2'], silver: ['#d7dce3', '#5d636c', '#ffffff'],
  gold: ['#e2c27a', '#6b5426', '#fff3d1'], platinum: ['#9fe0d8', '#24524f', '#e9fffb'], emerald: ['#5fd39a', '#16452f', '#dcffec'],
  diamond: ['#9cc4ff', '#20386b', '#ffffff'], master: ['#c9a0ff', '#3c2266', '#f4eaff'], grandmaster: ['#ff6f91', '#4d1226', '#ffe1ea'],
  legend: ['#ff8a72', '#5e1a12', '#ffe6dc']
};

// The tier hexagon, drawn the way tierEmblem() draws it in SVG.
export function drawEmblem(ctx, x, y, r, tier) {
  const id = TIER_METAL[tier] ? tier : 'iron';
  const [a, b, line] = TIER_METAL[id];
  const rank = Object.keys(TIER_METAL).indexOf(id);
  const hex = k => [[0, -1], [0.866, -0.5], [0.866, 0.5], [0, 1], [-0.866, 0.5], [-0.866, -0.5]].map(([px, py]) => [x + px * r * k, y + py * r * k]);
  const path = pts => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); };
  path(hex(1)); ctx.fillStyle = b; ctx.fill(); ctx.lineWidth = r * 0.085; ctx.strokeStyle = a; ctx.stroke();
  if (rank >= 3) { ctx.lineWidth = r * 0.05; ctx.strokeStyle = line; ctx.globalAlpha = 0.55; path(hex(0.66)); ctx.stroke(); ctx.globalAlpha = 1; }
  path([[x, y - r], [x + 0.866 * r, y - 0.5 * r], [x, y], [x - 0.866 * r, y - 0.5 * r]]);
  ctx.globalAlpha = 0.55; ctx.fillStyle = a; ctx.fill(); ctx.globalAlpha = 1;
  if (rank >= 6) drawStar(ctx, x, y + r * 0.1, r * 0.3, line);
}

function fit(ctx, text, max, size, weight, family) {
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(text).width > max && size > 30) { size -= 6; ctx.font = `${weight} ${size}px ${family}`; }
}

const SANS = 'Archivo, "Noto Sans KR", sans-serif';
const KR = '"Noto Sans KR", Archivo, sans-serif';

// One look for every brag: the VEGAS wordmark, a centrepiece (the star, or a tier emblem), the
// kicker, the headline, the big line in warm white, a quote, and who/when at the bottom.
export async function brandCard({ kicker = '', title = '', big = '', bigColor = '#fff6dc', quote = '', note = '', nickname = myName, tier = null, draw = null }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, H * 0.75);
  bg.addColorStop(0, '#1f242b'); bg.addColorStop(1, '#0a0b0d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);
  const logo = await loadLogo();
  if (logo) ctx.drawImage(logo, W / 2 - 180, 120, 360, 76);
  if (draw) draw(ctx, W / 2, 470);
  else if (tier) drawEmblem(ctx, W / 2, 470, 120, tier);
  else drawStar(ctx, W / 2, 470, 90, '#fff6dc');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b3b8bf';
  fit(ctx, kicker, W - 200, 40, 500, KR);
  ctx.fillText(kicker, W / 2, 650);
  ctx.fillStyle = '#f4f5f7';
  fit(ctx, title, W - 180, 128, 700, SANS);
  ctx.fillText(title, W / 2, 800);
  if (big) {
    ctx.fillStyle = bigColor;
    fit(ctx, big, W - 140, 88, 700, SANS);
    ctx.fillText(big, W / 2, 930);
  }
  if (quote) {
    ctx.fillStyle = '#f4f5f7';
    fit(ctx, quote, W - 160, 50, 600, KR);
    ctx.fillText(quote, W / 2, 1040);
  }
  ctx.fillStyle = '#7d838b';
  ctx.font = `400 32px ${KR}`;
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(`${nickname ? `${nickname} · ` : ''}${note || date}`, W / 2, 1150);
  ctx.fillText('가상 칩 · 현금 가치 없음', W / 2, 1210);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
