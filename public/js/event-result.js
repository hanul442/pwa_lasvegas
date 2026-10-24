// The end of an event, as its own moment: a film-title victory card (letterboxed, the event's name
// in lights, the prize rolling up, a share button), or a noir defeat (the lights go down, grain,
// where you finished). Each event names its own words for both.
import { el, sound, haptic, rollNumber, formatMoney, animate, ms, reducedMotion } from './fx.js';
import { shareWin } from './bigwin.js';

const WORDS = {
  royale: { win: 'CHAMPION', lose: 'ELIMINATED', winLine: '마지막 패까지 살아남은 단 한 사람.', loseLine: '르 시프르가 미소 지어요. 다음 판을 기약하세요.' },
  whale: { win: 'THE BIGGEST WHALE', lose: 'SUNK', winLine: '스카이 라운지에서 가장 큰 고래가 됐어요.', loseLine: '이 바다에는 더 큰 고래가 있었어요.' },
  rounders: { win: 'BOSS DOWN', lose: 'BUSTED', winLine: '현상금을 챙겼어요. 다음 보스가 기다려요.', loseLine: '보스가 판을 가져갔어요. 같은 자리에서 다시 도전할 수 있어요.' },
  oceans: { win: 'VAULT OPEN', winLine: '크루의 작전이 성공했어요.' },
  montecarlo: { win: 'GALA NIGHT', winLine: '몬테카를로의 밤이 당신 편이었어요.' },
  casablanca: { win: 'PLAY IT AGAIN', winLine: '릭이 잔을 들어요. 이 밤은 당신 거예요.' },
  godofgamblers: { win: '도신', winLine: '주사위 컵 아래 숫자를 다 읽었어요.' },
  friends: { win: 'CHAMPION', lose: 'ELIMINATED', winLine: '친구들 사이에서 마지막까지 살아남았어요.', loseLine: '다음 토너먼트에서 설욕해요.' },
  tazza: { win: '타짜', winLine: '아귀도 고광렬도 손을 털었어요.' }
};

// win: true for a victory card, false for the defeat; title: the event's name; place: 1st, 2nd…;
// amount: chips won (a victory) or lost (a defeat); detail: one line under the headline.
// rows: an optional final table, [{ place, name, note, me }], e.g. a friends' tournament's places.
export function eventResult({ event, win, title, place = null, amount = 0, detail = '', nickname = '', rows = [] }) {
  const words = WORDS[event] || {};
  const mark = win ? (place === 2 ? 'RUNNER-UP' : words.win || 'WINNER') : words.lose || 'GAME OVER';
  const line = win ? words.winLine || '' : words.loseLine || '';
  const headline = place ? `${place}위${win ? '' : '로 탈락'}` : '';
  return new Promise(resolve => {
    const node = el('div', `event-result event-result--${win ? 'win' : 'lose'} event-result--${event}`);
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', `${title} ${mark}${amount ? ` ${formatMoney(amount)}` : ''}`);
    node.innerHTML = `
      <div class="event-result-inner">
        <p class="event-result-kicker">${title}</p>
        ${win ? '<span class="event-result-star" aria-hidden="true"></span>' : '<span class="event-result-rule" aria-hidden="true"></span>'}
        <h2 class="event-result-mark" style="--chars:${Math.max(...mark.split(' ').map(w => w.length))}">${mark}</h2>
        ${headline ? `<p class="event-result-place">${headline}</p>` : ''}
        ${amount ? `<strong class="event-result-amount"><span data-amount>${win ? '+' : '−'}0원</span></strong>` : ''}
        ${detail ? `<p class="event-result-detail">${detail}</p>` : ''}
        ${line ? `<p class="event-result-line">${line}</p>` : ''}
        ${rows.length ? '<ol class="event-result-rows" aria-label="최종 순위"></ol>' : ''}
        <div class="event-result-actions">
          ${win && amount ? '<button type="button" class="pill-button pill-button--solid" data-share>자랑하기</button>' : ''}
          <button type="button" class="pill-button${win && amount ? '' : ' pill-button--solid'}" data-close>테이블로 돌아가기</button>
        </div>
      </div>`;
    const list = node.querySelector('.event-result-rows');
    for (const r of rows) {
      const li = el('li', r.me ? 'is-me' : '');
      li.innerHTML = '<b></b><span></span><small></small>';
      li.querySelector('b').textContent = r.place ? `${r.place}위` : '–';
      li.querySelector('span').textContent = r.name;
      li.querySelector('small').textContent = r.note || '';
      list.append(li);
    }
    document.body.append(node);
    requestAnimationFrame(() => node.classList.add('is-open'));
    if (win) { sound.win(); setTimeout(() => sound.chips(8), 300); haptic([40, 60, 40, 60, 160]); }
    else { sound.lose(); haptic([120]); }
    const amountEl = node.querySelector('[data-amount]');
    if (amountEl) rollNumber(amountEl, 0, amount, { duration: win ? 1600 : 900, format: v => `${win ? '+' : '−'}${formatMoney(v)}` });
    if (!reducedMotion()) {
      const markEl = node.querySelector('.event-result-mark');
      animate(markEl, win
        ? [{ letterSpacing: '.6em', opacity: 0 }, { letterSpacing: '.08em', opacity: 1 }]
        : [{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: win ? 1100 : 1400 });
    }

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      removeEventListener('keydown', onKey, true);
      node.classList.remove('is-open');
      setTimeout(() => { node.remove(); resolve(); }, ms(400));
    };
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); } };
    addEventListener('keydown', onKey, true);
    node.querySelector('[data-close]').addEventListener('click', close);
    node.querySelector('[data-share]')?.addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      await shareWin({ title: `${title} ${mark}`, amount, game: title, nickname }).catch(() => {});
      e.currentTarget.disabled = false;
    });
    (node.querySelector('[data-share]') || node.querySelector('[data-close]')).focus({ preventScroll: true });
  });
}
