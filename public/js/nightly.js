// 매일 밤 9시 홀덤 토너먼트 (lib/nightly-tourney.mjs): the home card. Before 21:00 it counts down
// and takes registrations; while it runs it shows how many are left across every table and sends
// a registered player to their seat; afterwards the night's places.
import { api, errorMessage } from './api.js';
import { el, formatCH, sound } from './fx.js';

const LIVE_POLL_MS = 8000;
// The big countdown in Korean units, so 19:42 never reads as a time of day.
const bigClock = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}<small>시간</small> ${m}<small>분</small>` : `${m}<small>분</small> ${String(x).padStart(2, '0')}<small>초</small>`;
};
const placeText = (r, field) => `${r.place}위${r.payout ? ` · ${formatCH(r.payout)}` : ''}`;

// One card per slot; it keeps itself current (a second's countdown, a poll while live).
export function mountNightly(slot, { getState, applyState, openTable, toast }) {
  let view = null, skew = 0, tickTimer = 0, pollTimer = 0, busy = false;

  function set(v) {
    if (!v) return;
    view = v;
    skew = Date.now() - v.serverNow;
    paint();
  }
  const now = () => Date.now() - skew;

  async function register(join) {
    if (busy) return;
    busy = true;
    paint();
    try {
      const res = await (join ? api.nightlyRegister() : api.nightlyUnregister());
      sound.chips?.(join ? 2 : 1);
      applyState?.(res.state);
      set(res.nightly);
      toast?.(join ? `등록했어요. 바이인 ${formatCH(res.nightly.buyIn)}은 시작까지 잠겨 있어요` : '등록을 취소했어요. 바이인을 돌려받았어요');
    } catch (e) { toast?.(errorMessage(e)); }
    busy = false;
    paint();
  }

  function paint() {
    if (!view) { slot.replaceChildren(); return; }
    const v = view, t = now();
    // Tonight's own hour, and the daily one from tomorrow (they differ the day the hour changes).
    const label = v.label || '밤 9시', at = v.clock || '21:00', daily = v.nextLabel || label, nextAt = v.nextClock || at;
    const status = v.status === 'REG' && t >= v.startsAt ? 'RUNNING' : v.status;
    const card = el('article', `nightly-card is-${status.toLowerCase()}`);
    card.setAttribute('aria-label', `매일 ${daily} 홀덤 토너먼트`);
    const badge = status === 'RUNNING' ? '<span class="nightly-live">LIVE</span>'
      : status === 'REG' ? `<span class="nightly-when">오늘 ${at}</span>` : `<span class="nightly-when">내일 ${nextAt}</span>`;
    let big, sub;
    if (status === 'REG') {
      big = `<b class="nightly-big" data-nightly-clock>${bigClock(v.startsAt - t)}</b>`;
      sub = v.people ? `시작까지 · ${v.people}명 등록` : '시작까지 · 첫 번째로 등록해 보세요';
    } else if (status === 'RUNNING') {
      big = v.left == null ? '<b class="nightly-big">시작!</b>' : `<b class="nightly-big">${v.left}<small>/${v.field}</small></b>`;
      sub = v.left == null ? '테이블에 카드가 나가요' : `남은 인원 · 테이블 ${v.tables}개${v.level ? ` · 레벨 ${v.level}` : ''}`;
    } else if (v.winner) {
      big = `<b class="nightly-big nightly-big--name">${v.winner.me ? '내가 우승!' : v.winner.name}</b>`;
      sub = v.winner.me ? `${v.field}명 중 1위` : `${v.winner.kind === 'bot' ? 'AI · ' : ''}오늘 밤 우승 · ${v.field}명 참가`;
    } else {
      big = `<b class="nightly-big" data-nightly-clock>${bigClock(v.next - t)}</b>`;
      sub = '다음 토너먼트까지 · 자정부터 등록';
    }
    const payouts = v.payouts.slice(0, 3).map((p, i) => `${i + 1}위 ${formatCH(p)}`).join(' · ');
    card.innerHTML = `
      <header class="nightly-head"><span class="nightly-kicker">매일 ${daily} · 홀덤 토너먼트</span>${badge}</header>
      <div class="nightly-main">${big}<span class="nightly-sub">${sub}</span></div>
      <dl class="nightly-stats">
        <div><dt>바이인</dt><dd>${formatCH(v.buyIn)}</dd></div>
        <div><dt>상금</dt><dd>${formatCH(v.prize)}</dd></div>
        <div><dt>${status === 'REG' ? '등록' : '참가'}</dt><dd>${status === 'REG' ? v.people : v.field}<small>명</small></dd></div>
      </dl>
      <p class="nightly-pay">${payouts}${v.payouts.length > 3 ? ` 외 ${v.payouts.length - 3}명` : ''} · 빈 자리는 AI가 앉아요${status === 'REG' && v.last?.winner ? `<br>지난번 우승 · ${v.last.winner.kind === 'bot' ? 'AI ' : ''}${v.last.winner.name}${v.last.top?.find(r => r.me) ? ` · 나는 ${v.last.top.find(r => r.me).place}위` : ''}` : ''}</p>`;
    // Who's in (before), and the places so far (live and after).
    const rows = status === 'REG' ? v.names.map(n => ({ text: n, me: v.registered && n === getState()?.user?.nickname })) : v.top.map(r => ({ text: `${r.name} ${placeText(r)}`, me: r.me }));
    if (rows.length) {
      const ul = el('ul', 'nightly-names');
      for (const r of rows.slice(0, 6)) ul.append(el('li', r.me ? 'is-me' : '', r.text));
      card.append(ul);
    }
    const actions = el('div', 'nightly-actions');
    const button = (text, cls, onClick, disabled = false) => {
      const b = el('button', cls, text);
      b.type = 'button';
      b.disabled = disabled || busy;
      b.addEventListener('click', onClick);
      actions.append(b);
      return b;
    };
    if (status === 'REG' && !v.registered) {
      if (v.people >= v.maxPeople) actions.append(el('span', 'nightly-note', '오늘은 자리가 다 찼어요'));
      else if (!v.canAfford) { button(`칩 ${formatCH(v.buyIn)} 필요`, 'home-cta nightly-cta', () => {}, true); }
      else button(`등록하기 · ${formatCH(v.buyIn)}`, 'home-cta nightly-cta', () => register(true));
    } else if (status === 'REG') {
      actions.append(el('span', 'nightly-done', '등록 완료'));
      button('취소', 'home-ghost', () => register(false));
      actions.append(el('span', 'nightly-note', `${label.split(' ')[1]} 정각에 자리를 정해 드려요 · 10분 전에 알림`));
    } else if (status === 'RUNNING' && v.me?.seated) {
      button('내 테이블로', 'home-cta nightly-cta', () => openTable(v));
      if (v.me.place) actions.append(el('span', 'nightly-note', `${v.me.place}위로 탈락${v.me.payout ? ` · 상금 ${formatCH(v.me.payout)}` : ''}`));
    } else if (status === 'RUNNING' && v.me?.place) {
      actions.append(el('span', 'nightly-done', `${v.me.place}위${v.me.payout ? ` · +${formatCH(v.me.payout)}` : ''}`));
    } else if (status === 'RUNNING') {
      actions.append(el('span', 'nightly-note', `등록은 마감됐어요 · 내일 ${daily}에 만나요`));
    } else if (v.me?.place) {
      actions.append(el('span', 'nightly-done', `오늘 ${v.me.place}위${v.me.payout ? ` · +${formatCH(v.me.payout)}` : ''}`));
    }
    if (actions.childElementCount) card.append(actions);
    slot.replaceChildren(card);
    schedule(status);
  }

  // A second's countdown before; a poll for the live count while it runs.
  function schedule(status) {
    clearInterval(tickTimer);
    clearTimeout(pollTimer);
    if (!slot.isConnected) return;
    if (status === 'REG' || status === 'DONE' || status === 'CANCELLED') {
      tickTimer = setInterval(() => {
        const c = slot.querySelector('[data-nightly-clock]');
        if (!c || !slot.isConnected) return;
        const left = (status === 'REG' ? view.startsAt : view.next) - now();
        if (left <= 0) { refresh(); return; }
        c.innerHTML = bigClock(left);
      }, 1000);
    }
    if (status === 'RUNNING') pollTimer = setTimeout(() => { if (!document.hidden) refresh(); else schedule(status); }, LIVE_POLL_MS);
  }

  async function refresh() {
    clearInterval(tickTimer);
    try { set((await api.nightly()).nightly); } catch { schedule(view?.status); }
  }

  return {
    update(state) { if (state?.nightly) set(state.nightly); },
    refresh,
    stop() { clearInterval(tickTimer); clearTimeout(pollTimer); }
  };
}
