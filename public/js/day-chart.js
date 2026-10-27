// The day's chips as a line, one point a round (lib/loss-tally.mjs curve): white up to the
// day's high, red from there down. Used by the bust screen and the 오늘의 손익 sheet.
// Lines are SVG stretched to the box (non-scaling strokes); the dots and labels are HTML laid
// over it by percent, so text never stretches.
import { formatCH } from './money.js';

const W = 300, H = 100, PAD = 8;
const clock = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function chartPoints(curve) {
  const pts = (Array.isArray(curve) ? curve : []).filter(p => Array.isArray(p) && Number.isFinite(p[1]));
  if (pts.length < 2) return null;
  // Scaled between the day's low and high, so a quiet day still shows its shape.
  const values = pts.map(p => p[1]);
  const lo = Math.min(...values), max = Math.max(...values, lo + 1);
  let top = 0;
  pts.forEach((p, i) => { if (p[1] >= pts[top][1]) top = i; });
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * W, PAD + (1 - (p[1] - lo) / (max - lo)) * (H - PAD * 2)]);
  return { pts, xy, top, max, lo };
}

const path = xy => xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

// opts.end: label for the last point ("0원"); opts.className: extra class on the box.
export function dayChart(curve, { end = '', className = '' } = {}) {
  const c = chartPoints(curve);
  if (!c) return '';
  const { pts, xy, top } = c;
  const up = xy.slice(0, top + 1), down = xy.slice(top);
  const area = `${path(xy)}L${W} ${H}L0 ${H}Z`;
  const pct = ([x, y]) => `left:${(x / W * 100).toFixed(2)}%;top:${(y / H * 100).toFixed(2)}%`;
  const last = xy[xy.length - 1];
  const fell = top < xy.length - 1 && pts[pts.length - 1][1] < pts[top][1];
  const topLabel = `최고 ${formatCH(pts[top][1])}${Number.isFinite(pts[top][0]) ? ` · ${clock(pts[top][0])}` : ''}`;
  // The high's label sits on whichever side has room.
  const side = xy[top][0] > W * 0.62 ? 'is-left' : xy[top][0] < W * 0.2 ? 'is-right' : '';
  return `<figure class="day-chart ${className}" aria-label="오늘 칩 흐름: ${topLabel}${fell ? `, 지금 ${formatCH(pts[pts.length - 1][1])}` : ''}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="day-chart-area" d="${area}"/>
      <path class="day-chart-up" pathLength="1" d="${path(up)}" vector-effect="non-scaling-stroke"/>
      ${down.length > 1 ? `<path class="day-chart-down${fell ? ' is-fall' : ''}" pathLength="1" d="${path(down)}" vector-effect="non-scaling-stroke"/>` : ''}
    </svg>
    <span class="day-chart-dot day-chart-dot--top" style="${pct(xy[top])}"></span>
    <span class="day-chart-label ${side}" style="${pct(xy[top])}">${topLabel}</span>
    ${fell ? `<span class="day-chart-dot day-chart-dot--end" style="${pct(last)}"></span>${end ? `<span class="day-chart-end" style="${pct(last)}">${end}</span>` : ''}` : ''}
  </figure>`;
}
