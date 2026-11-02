// 시즌 레이스 (lib/rank-race.mjs): the clock to the season's end, the player I'm chasing, the one
// chasing me, and the gap to the podium. On the ranking tab as a card, on home as one line.
// 막판 스퍼트: the season's last seven days double a won round's RP.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');

// "12일 3시간" while days are left; the last day counts down to the second.
export function raceClock(iso, now = Date.now()) {
  const ms = Math.max(0, Date.parse(iso) - now);
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86_400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  if (!ms) return '마감';
  return d > 0 ? `${d}일 ${h}시간` : `${pad(Math.floor(s / 3600))}:${pad(m)}:${pad(s % 60)}`;
}
const final = (iso, now = Date.now()) => Date.parse(iso) - now <= 86_400_000;
const dateText = iso => { const k = new Date(Date.parse(iso) + 9 * 3_600_000); return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`; };

// One clock for every [data-race-clock] on screen.
let ticking = null;
export function startRaceClock() {
  if (ticking) return;
  ticking = setInterval(() => {
    for (const n of document.querySelectorAll('[data-race-clock]')) {
      const t = raceClock(n.dataset.raceClock);
      if (n.textContent !== t) n.textContent = t;
      n.closest('.race-card, .home-race')?.classList.toggle('is-final', final(n.dataset.raceClock));
    }
  }, 1000);
}

function spurtHtml(sp) {
  if (!sp) return '';
  return sp.active
    ? `<span class="race-spurt" title="마지막 7일은 이긴 판 RP가 ${sp.times}배">막판 스퍼트 <b>RP ${sp.times}배</b></span>`
    : '';
}

export function raceHtml(state, frame = (id, n) => esc(n)) {
  const r = state?.race;
  if (!r) return '';
  const lane = [];
  if (r.above) lane.push(`<li class="race-row is-above"><span class="race-no">${r.above.rank}</span><span class="race-name">${frame(r.above.id, esc(r.above.nickname))}</span><span class="race-rp">${r.above.rp} RP</span><span class="race-gap">${r.rank ? `<b>${r.above.need} RP</b>면 추월` : `<b>${r.above.need} RP</b>면 순위권`}</span></li>`);
  if (r.rank) lane.push(`<li class="race-row is-me"><span class="race-no">${r.rank}</span><span class="race-name">나</span><span class="race-rp">${r.rp} RP</span><span class="race-gap">${r.of}명 중</span></li>`);
  if (r.below) lane.push(`<li class="race-row is-below"><span class="race-no">${r.below.rank}</span><span class="race-name">${frame(r.below.id, esc(r.below.nickname))}</span><span class="race-rp">${r.below.rp} RP</span><span class="race-gap">${r.below.gap ? `<b>${r.below.gap} RP</b> 뒤에서 추격` : '<b>동점</b>, 바로 뒤'}</span></li>`);
  const foot = !r.rank
    ? '한 판 하면 이번 시즌 순위에 들어가요.'
    : r.podium ? `3위까지 <b>${r.podium.need} RP</b> · 1~3위는 시즌 챌린저 배지`
    : `지금 <b>챌린저권</b>이에요 · 마감 때 1~3위가 챌린저 배지`;
  const soon = r.spurt && !r.spurt.active ? `<p class="race-note">${dateText(r.spurt.startsAt)}부터 막판 스퍼트: 이긴 판 RP ${r.spurt.times}배</p>` : '';
  return `<section class="race-card${r.spurt?.active ? ' is-spurt' : ''}${final(r.endsAt) ? ' is-final' : ''}" aria-label="시즌 레이스">
    <div class="race-head"><div><small>시즌 레이스 · ${esc(r.name)}</small><strong>마감까지 <b data-race-clock="${r.endsAt}">${raceClock(r.endsAt)}</b></strong></div>${spurtHtml(r.spurt)}</div>
    ${lane.length ? `<ol class="race-lane">${lane.join('')}</ol>` : ''}
    <p class="race-foot">${foot}</p>${soon}
  </section>`;
}

// Home: one line under the tier card.
export function homeRaceHtml(state) {
  const r = state?.race;
  if (!r) return '';
  const chase = !r.rank ? '한 판 하면 순위에 들어가요'
    : r.rank === 1 ? (r.below ? `1위 · 2위와 <b>${r.below.gap} RP</b>` : '1위')
    : `${r.above.rank}위까지 <b>${r.above.need} RP</b>`;
  return `<span class="home-race${r.spurt?.active ? ' is-spurt' : ''}${final(r.endsAt) ? ' is-final' : ''}"><span class="home-race-clock"><i>마감 </i><b data-race-clock="${r.endsAt}">${raceClock(r.endsAt)}</b></span><span class="home-race-chase">${chase}</span>${r.spurt?.active ? `<span class="home-race-spurt">RP ${r.spurt.times}배</span>` : ''}</span>`;
}
