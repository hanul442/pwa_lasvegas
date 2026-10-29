// 오늘의 손익: the home chip opens the whole day at the tables — the net, the chip curve, what
// went where and which game took the most (lib/loss-tally.mjs). 한서 (2026-10-27): "얼마
// 잃었는지 보여주는 게 많았으면".
import { el } from './fx.js';
import { formatCH } from './money.js';
import { gameName } from './names.js';
import { dayChart } from './day-chart.js';

const signed = n => `${n < 0 ? '-' : n > 0 ? '+' : ''}${formatCH(Math.abs(n))}`;
const tone = n => (n < 0 ? 'is-down' : n > 0 ? 'is-up' : '');

export function dayBlock(state) {
  const d = state?.user?.today;
  if (!d?.rounds) return null;
  const m = state.user.month;
  const net = d.net ?? d.won - d.lost;
  const box = el('section', 'lounge-block day-sheet');
  const games = Object.entries(d.games || {}).sort((a, b) => a[1].net - b[1].net);
  const wins = d.rounds - (d.losses || 0);
  const rows = [
    ['딴 돈', `+${formatCH(d.won)}`, 'is-up'],
    ['잃은 돈', `-${formatCH(d.lost)}`, 'is-down'],
    ['한 판 최대 승', d.best ? `+${formatCH(d.best)}` : '없음', d.best ? 'is-up' : ''],
    ['한 판 최대 패', d.worst ? `-${formatCH(d.worst)}` : '없음', d.worst ? 'is-down' : ''],
    ['오늘 최고점', `${formatCH(d.peak)}`, ''],
    ...(d.high > 0 && net < d.high ? [['최고 수익에서 놓친 돈', `-${formatCH(d.high - net)}`, 'is-down']] : []),
    ...(d.busts ? [['파산', `${d.busts}번`, 'is-down']] : []),
    // 뽀찌 (lib/tips.mjs) is chips given away, not a hand lost, so it stands on its own line.
    ...(d.tips ? [['딜러 팁', `-${formatCH(d.tips)}`, '']] : []),
    ...(m?.rounds > d.rounds ? [[`이번 달 · ${m.rounds}판`, signed(m.net ?? m.won - m.lost), tone(m.net ?? m.won - m.lost)]] : [])
  ];
  box.innerHTML = `
    <header class="lounge-head"><h2>오늘의 손익</h2></header>
    <strong class="day-sheet-net ${tone(net)}">${signed(net)}<small>원</small></strong>
    <p class="day-sheet-count">${d.rounds}판 · ${wins}승 ${d.losses || 0}패${d.losingRun >= 2 ? ` · <b class="is-down">지금 ${d.losingRun}연패</b>` : d.winningRun >= 2 ? ` · <b class="is-up">지금 ${d.winningRun}연승</b>` : ''}</p>
    ${dayChart(d.curve)}
    <dl class="day-sheet-rows">${rows.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c}">${v}</dd></div>`).join('')}</dl>
    ${games.length ? `<h3 class="day-sheet-sub">게임별</h3><ul class="day-sheet-games">${games.map(([g, r]) => `<li><span>${gameName(g) || g}<small>${r.rounds}판</small></span><b class="${tone(r.net)}">${signed(r.net)}</b></li>`).join('')}</ul>` : ''}
    <p class="day-sheet-note">자정에 새로 시작해요 · 가상 칩 · 현금 가치 없음</p>`;
  return box;
}
