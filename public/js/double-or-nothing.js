// 더블 오어 낫띵 (묻고 더블로 가) at the blackjack and baccarat tables: right after a win the
// dealer offers to put the whole win on the colour of one card. The server draws the card
// (lib/double-or-nothing.mjs); a won gamble may be pressed again, up to three times.
import { api, errorMessage } from './api.js';
import { el, formatCH, wait, sound, haptic, animate, formatUnit } from './fx.js';
import { createCard, flipCard } from './cards.js';

const MAX_STEPS = 3;

export function createDoubleOrNothing(t) {
  const panel = el('div', 'don');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '묻고 더블로 가');
  t.felt.append(panel);
  let token = 0;

  function hide() { token++; panel.hidden = true; panel.replaceChildren(); }
  // Any new hand takes the offer off the table.
  const lock = t.lock.bind(t);
  t.lock = (...args) => { hide(); return lock(...args); };

  function offer(roundId, stake, step = 1) {
    const mine = ++token;
    panel.replaceChildren();
    panel.hidden = false;
    const head = el('div', 'don-head', `<span class="don-kicker">${step > 1 ? `한 번 더 · ${step}/${MAX_STEPS}` : '묻고 더블로 가?'}</span><strong class="don-stake">${formatUnit(stake)}</strong><small>빨강·검정을 맞히면 두 배, 틀리면 0</small>`);
    const card = createCard(null, { faceUp: false });
    card.classList.add('don-card');
    const picks = el('div', 'don-picks');
    const btn = (label, cls, onClick) => { const b = el('button', `don-btn ${cls}`, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
    const take = btn('그냥 받기', 'don-btn--take', () => { sound.tick(); hide(); });
    const red = btn('빨강', 'don-btn--red', () => pick('RED'));
    const black = btn('검정', 'don-btn--black', () => pick('BLACK'));
    picks.append(take, red, black);
    panel.append(head, card, picks);
    animate(panel, [{ opacity: 0, transform: 'translate(-50%,12px)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: 260 });
    red.focus({ preventScroll: true });

    async function pick(color) {
      if (mine !== token) return;
      picks.querySelectorAll('button').forEach(b => { b.disabled = true; });
      sound.chip();
      let res;
      try { res = await api.double(roundId, color); }
      catch (e) { t.toast(errorMessage(e)); hide(); return; }
      const d = res.double;
      await flipCard(card, d.card, { duration: 520, squeeze: true });
      t.setServerState(res.state);
      head.querySelector('small').textContent = d.won ? `맞혔어요! +${formatUnit(d.stake)}` : `아쉬워요. ${formatUnit(d.stake)}을 돌려줬어요`;
      panel.classList.toggle('is-won', d.won);
      panel.classList.toggle('is-lost', !d.won);
      if (d.won) { sound.win(); haptic([20, 60, 30]); t.banner('Double', 'win', d.stake); }
      else { sound.lose(); haptic(30); t.banner('Nothing', 'lose', -d.stake); }
      await t.syncBalance();
      await wait(1100);
      if (mine !== token) return;
      if (d.won && d.next) offer(d.id, d.next, d.step + 1);
      else hide();
    }
  }

  return { offer, hide };
}
