// 랭킹 탭 (its own place in the bottom menu since 2026-10-28): my tier this month up top, the ladder
// of all ten tiers, past months, and 친구 전적 (lib/friend-record.mjs). The boards themselves are
// drawn in app.js renderRanking.
import { formatCH } from './fx.js';
import { gameName } from './names.js';
import { tierEmblem, tierName, rankBadges, TIERS, rpMode } from './rank.js';

const signed = v => `${v > 0 ? '+' : ''}${formatCH(v)}`;
const tone = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : m < 43_200 ? `${Math.round(m / 1440)}일 전` : `${Math.round(m / 43_200)}달 전`;
}
function leftText(iso) {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const d = Math.floor(ms / 86_400_000), h = Math.floor(ms / 3_600_000) % 24, m = Math.floor(ms / 60_000) % 60;
  return d > 0 ? `${d}일 ${h}시간` : h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// My place on this month's board (state.rankings.tier lists every ranked player).
export function myMonthRank(state) {
  const rows = state?.rankings?.tier || [];
  const mine = rows.find(r => r.id === state?.user?.id);
  return mine ? { rank: mine.rank, of: rows.length } : null;
}

// The big card: emblem, tier, this month's peak, the climb to the next tier, and where I stand.
export function tierHeroHtml(state) {
  const rs = state?.rankSeason;
  if (!rs) return '<p class="lounge-note">티어를 불러오는 중이에요.</p>';
  const pct = Math.round((rs.progress || 0) * 100);
  const place = myMonthRank(state);
  const next = rs.next
    ? `<span>${tierName(rs.next.id, rs.next.division)}까지 <b>${rpMode(rs) ? `${rs.next.need} RP` : `${formatCH(rs.next.need)}원`}</b></span>`
    : '<span><b>최고 티어</b>에 올랐어요</span>';
  return `
    <div class="tier-hero-top"><span class="tier-hero-season">${rs.season.name}</span><span class="tier-hero-clock">${leftText(rs.season.endsAt)} 남음</span></div>
    <div class="tier-hero-main">
      <span class="tier-hero-emblem">${tierEmblem(rs.tier, { size: 84 })}</span>
      <div class="tier-hero-name"><small>이번 달 티어</small><strong>${tierName(rs.tier, rs.division)}</strong></div>
    </div>
    <div class="tier-hero-climb">
      <div class="tier-hero-bar" role="progressbar" aria-label="다음 티어까지" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <p>${next}<span>${pct}%</span></p>
    </div>
    <dl class="tier-hero-stats">
      <div><dt>이번 달 순위</dt><dd>${place ? `${place.rank}<small>위 / ${place.of}명</small>` : '<small>아직 없음</small>'}</dd></div>
      ${rpMode(rs) ? `<div><dt>이번 달 RP</dt><dd>${rs.rp}</dd></div>` : `<div><dt>최고 순자산</dt><dd>${formatCH(rs.peak)}</dd></div>`}
      <div><dt>역대 최고</dt><dd>${rs.best ? tierName(rs.best.tier) : '<small>첫 시즌</small>'}</dd></div>
    </dl>
    <div class="tier-hero-foot"><small>${rs.carry ? '매달 1일 0시에 RP가 3티어 내려가요' : '매달 1일 0시에 칩·빚이 초기화돼요'}</small><span class="tier-hero-actions"><button type="button" class="link-button" data-season-rules>자세히</button></span></div>`;
}

// RP 베타 (lib/rank-points.mjs): the score that becomes the tier from the December season. It moves
// with each round by what the round won against its own bet, so bigger bets don't buy it.
export function rpCardHtml(state) {
  const rp = state?.rp;
  if (!rp) return '';
  // Once RP is the tier, the hero above already shows it; this card keeps only the rules.
  if (rp.era) return `<p class="rp-card-rule">티어는 RP로 정해져요. 티어마다 IV부터 I까지 25 RP씩 네 단계예요. 이기면 건 돈 대비 번 만큼 오르고(+10 = 건 만큼 땀), 지면 그 3/4만 내려가요. 한 판·하루 상한은 없어요. 내 티어보다 높은 층에서 이기면 1.5배, 낮은 층은 0.5배.${rp.floors ? '' : ' RP 티어가 오르면 위층이 열려요.'} 오늘 +${rp.today}</p>`;
  const pct = Math.round(Math.max(0, Math.min(1, rp.progress || 0)) * 100);
  const last = rp.last && Date.now() - Date.parse(rp.last.at) < 6 * 3_600_000 ? `<span class="rp-last ${rp.last.delta > 0 ? 'pos' : rp.last.delta < 0 ? 'neg' : ''}">방금 ${rp.last.delta > 0 ? '+' : ''}${rp.last.delta}</span>` : '';
  const board = state?.rankings?.rp || [];
  const mine = board.find(r => r.id === state?.user?.id);
  return `
    <div class="rp-card-head"><span class="rp-badge">RP 베타</span><small>12월 시즌부터 이 점수가 티어가 돼요</small></div>
    <div class="rp-card-main">
      ${tierEmblem(rp.tier, { size: 44 })}
      <div class="rp-card-name"><strong>${tierName(rp.tier, rp.division)}</strong><span><b>${rp.points}</b> RP ${last}</span></div>
      <span class="rp-card-rank">${mine ? `${mine.rank}<small>위</small>` : '<small>순위 없음</small>'}</span>
    </div>
    <div class="tier-hero-bar" role="progressbar" aria-label="다음 RP 티어까지" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <p class="rp-card-foot"><span>${rp.next ? `${tierName(rp.next, rp.nextDivision)}까지 ${rp.toNext} RP` : '최고 티어'}</span><span>오늘 +${rp.today}</span></p>
    <p class="rp-card-rule">이기면 건 돈 대비 번 만큼 오르고(+10 = 건 만큼 땀), 지면 그 3/4만 내려가요. 한 판·하루 상한은 없어요. 내 티어보다 높은 층에서 이기면 1.5배.</p>`;
}

// 주간 리그 (lib/rank-league.mjs): my group of thirty, ranked by this week's RP. The top five move
// up a league and the bottom five down when the week ends (Monday 0시); AI fill the empty seats.
export function leagueHtml(state, frame = (id, n) => n) {
  const lg = state?.league;
  if (!lg) return '<p class="lounge-note">리그를 불러오는 중이에요.</p>';
  const last = lg.last ? `<p class="league-last">지난주 ${lg.last.rank}위 / ${lg.last.of}명 · ${lg.last.move > 0 ? '승급했어요' : lg.last.move < 0 ? '강등됐어요' : '잔류'}</p>` : '';
  const head = `<div class="league-head"><div><small>이번 주 리그</small><strong>${lg.name}</strong></div><span class="league-clock">${leftText(lg.endsAt)} 남음</span></div>
    <p class="league-rule">이번 주에 얻은 RP로 30명이 겨뤄요. ${lg.top ? '' : `상위 ${lg.up}명은 승급, `}${lg.bottom ? '' : `하위 ${lg.down}명은 강등, `}1~3위는 배지를 받아요. 월요일 0시에 끝나요.</p>${last}`;
  if (!lg.joined) return `${head}<p class="league-empty">${state.user?.guest ? '이름을 정하고 계정을 만들면 리그에 들어갈 수 있어요.' : `이번 주 첫 판을 하면 ${lg.name} 30명 조에 들어가요.`}</p>`;
  const of = lg.rows.length;
  const rows = lg.rows.map(r => {
    const zone = !lg.top && r.rank <= lg.up ? 'is-up' : !lg.bottom && r.rank > of - lg.down ? 'is-down' : '';
    const line = !lg.top && r.rank === lg.up ? ' has-line' : !lg.bottom && r.rank === of - lg.down ? ' has-line' : '';
    return `<li class="league-row ${zone}${line}${r.me ? ' is-me' : ''}"><span class="rank-no">${r.rank}</span><span class="league-name">${r.ai ? r.nickname : frame(r.id, r.nickname)}${r.me ? ' <small>나</small>' : ''}${r.ai ? ' <small class="league-ai">AI</small>' : ''}</span><span class="rank-value">${r.value} RP</span></li>`;
  }).join('');
  return `${head}<div class="league-me"><span class="rank-me-no">${lg.rank}<small>위</small></span><span class="rank-me-text"><b>${lg.score} RP</b><small>${lg.rank <= lg.up && !lg.top ? '승급권이에요' : lg.rank > of - lg.down && !lg.bottom ? '강등권이에요. 한 판 더!' : '잔류권'}</small></span></div><ol class="league-list" aria-label="${lg.name} 순위">${rows}</ol>`;
}

// All ten tiers, highest first: what each needs, how many players sit there this month, and mine.
export function tierStepsHtml(state) {
  const rs = state?.rankSeason;
  const ids = Object.keys(TIERS);
  const mine = ids.indexOf(rs?.tier || 'iron');
  const count = {};
  for (const r of state?.rankings?.tier || []) if (r.tier) count[r.tier] = (count[r.tier] || 0) + 1;
  return ids.map((id, i) => ({ id, i })).reverse().map(({ id, i }) => {
    const state_ = i < mine ? 'is-done' : i === mine ? 'is-me' : 'is-ahead';
    const rp = rpMode(rs);
    const need = i > mine && rs ? Math.max(0, rp ? i * 100 - rs.rp : TIERS[id].min - rs.peak) : 0;
    const note = i === mine ? '<em>지금</em>' : i < mine ? '<span class="tier-step-check" aria-label="달성">✓</span>' : `<span class="tier-step-need">${rp ? `${need} RP` : formatCH(need)} 더</span>`;
    return `<li class="tier-step ${state_}">${tierEmblem(id, { size: 30, label: false })}<span class="tier-step-name"><b>${tierName(id)}</b><small>${i === 0 ? '시작' : rp ? `RP ${i * 100} 이상` : `${TIERS[id].label} 이상`}${count[id] ? ` · ${count[id]}명` : ''}</small></span>${note}</li>`;
  }).join('');
}

// Last month's 챌린저 and my badge from each month played.
export function tierPastHtml(state) {
  const rs = state?.rankSeason;
  if (!rs) return '';
  const last = rs.last?.podium?.length
    ? `<p class="season-last">${rs.last.name} 챌린저 ${rs.last.podium.map(p => `${p.rank}위 ${p.nickname}`).join(' · ')} <button type="button" class="link-button" data-last-season>결과 보기</button></p>`
    : '';
  const history = rs.history?.length ? `<h2 class="sub-head">지난 시즌 <small>최고 ${tierName(rs.best?.tier || rs.history[0].tier)}</small></h2>${rankBadges(rs.history)}` : '';
  return last || history ? `${history}${last}` : '';
}

// 친구 전적: one row per friend (who came out ahead in the hands we shared), then recent sittings.
export function friendRecordHtml(state, frame = (id, n) => n) {
  const fr = state?.friendRecord || { recent: [], vs: [] };
  if (!fr.vs.length && !fr.recent.length) {
    return `<div class="friend-empty"><b>아직 친구와 한 판이 없어요</b><small>섯다·고스톱·맞고·블랙잭·바카라·홀덤에서 친구 방을 만들거나 초대 링크로 들어가면 여기에 쌓여요.</small><button type="button" class="pill-button pill-button--solid" data-friend-play>친구랑 하러 가기</button></div>`;
  }
  const total = fr.vs.reduce((t, v) => ({ won: t.won + v.won, lost: t.lost + v.lost }), { won: 0, lost: 0 });
  const vs = fr.vs.map(v => {
    const decided = v.won + v.lost;
    const rate = decided ? Math.round((v.won / decided) * 100) : null;
    return `<li class="friend-row">
      <span class="friend-mono" aria-hidden="true">${[...(v.nickname || '?')][0]}</span>
      <span class="friend-main"><b>${frame(v.id, v.nickname)}</b><small>함께 ${v.hands}판 · ${gameName(v.lastGame)} ${ago(v.last)}</small></span>
      <span class="friend-score">${decided ? `<b>${v.won}<i>승</i> ${v.lost}<i>패</i></b><small>${rate}%</small>` : '<small>승패 없음</small>'}</span>
    </li>`;
  }).join('');
  const recent = fr.recent.map(r => {
    const who = r.with.slice(0, 3).map(w => w.nickname).join(', ') + (r.with.length > 3 ? ` 외 ${r.with.length - 3}명` : '');
    const what = r.tourney
      ? `토너먼트 ${r.place ? `${r.place}위` : ''}${r.of ? ` / ${r.of}명` : ''}`
      : `${r.hands}판${r.wins || r.losses ? ` · ${r.wins}승 ${r.losses}패` : ''}`;
    return `<li class="friend-game">
      <span class="friend-game-main"><b>${gameName(r.game)}${r.tourney ? ' 토너먼트' : ''} <small>with ${who}</small></b><small>${what} · ${ago(r.at)}</small></span>
      <span class="friend-game-net ${tone(r.net)}">${signed(r.net)}</span>
    </li>`;
  }).join('');
  return `
    ${fr.vs.length ? `<h2 class="sub-head">친구별 전적 <small>${total.won}승 ${total.lost}패</small></h2><ul class="friend-list">${vs}</ul><p class="friend-note">같은 판에서 누가 더 땄는지로 셉니다. 홀덤 일반 방은 함께한 판만 세요.</p>` : ''}
    ${fr.recent.length ? `<h2 class="sub-head">최근 친구 게임</h2><ul class="friend-games">${recent}</ul>` : ''}`;
}
