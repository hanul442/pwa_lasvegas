const app = document.querySelector('#app');
let lastGame = null;

const overlayOpen = () => Boolean(document.querySelector('.overlay [data-close]'));
const gameButton = id => id ? document.querySelector(`[data-game="${CSS.escape(id)}"]`) : null;

function restoreGameFocus() {
  const target = gameButton(lastGame);
  if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
}

function closeVisibleGame({ restoreFocus = true } = {}) {
  const close = document.querySelector('.overlay [data-close]');
  if (!close) return false;
  close.click();
  if (restoreFocus) restoreGameFocus();
  return true;
}

document.addEventListener('click', event => {
  const game = event.target.closest?.('[data-game]');
  if (game && !game.disabled) {
    lastGame = game.dataset.game;
    if (!history.state?.svGameModal) {
      history.pushState({ ...(history.state || {}), svGameModal: lastGame }, '', location.href);
    }
    return;
  }

  const close = event.target.closest?.('[data-close]');
  if (close && history.state?.svGameModal) {
    history.back();
  }
}, true);

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !overlayOpen()) return;
  event.preventDefault();
  if (history.state?.svGameModal) history.back();
  else closeVisibleGame();
});

addEventListener('popstate', () => {
  if (overlayOpen()) closeVisibleGame();
});

if (app) {
  new MutationObserver(() => {
    document.documentElement.classList.toggle('game-overlay-open', overlayOpen());
  }).observe(app, { childList: true, subtree: true });
}
