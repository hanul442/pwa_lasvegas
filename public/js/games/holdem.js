// Texas Hold'em against AI opponents: buy in with chips, cards pitched round the table,
// bets pushed out and raked into the pot, the pot pushed to the winner. The server deals
// and plays the bots; this screen replays its events one by one so every move is visible.
// The felt itself lives in holdem-view.js; "친구와 함께" seats friends at it (holdem-room.js).
import { api, errorMessage } from '../api.js';
import { wait, formatCH, flyFrom, flyTo, animate, sound } from '../fx.js';
import { createChip, breakdown } from '../chips.js';
import { Table } from '../table.js';
import { voice } from '../voice.js';
import { createPokerFelt, createActionBar } from './holdem-view.js';
import { createFriends } from './holdem-room.js';

export async function mountHoldem(ctx) {
  const t = new Table({ ...ctx, game: 'holdem', title: "Hold'em", feltClass: 'felt--poker' });
  const pk = createPokerFelt(t, { sitdown: `
    <button type="button" class="zone pk-buyin" data-zone="buyin"><strong>Buy-in</strong><small data-blinds></small></button>
    <div class="pk-opponents" role="radiogroup" aria-label="상대 수">
      <span>상대</span>${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-opp="${n}" aria-checked="${n === 5}">${n}</button>`).join('')}
    </div>
    <button type="button" class="pk-friends-open" data-friends-open>친구와 함께</button>` });
  t.body.querySelector('[data-blinds]').textContent = `블라인드 ${formatCH(pk.bb / 2)} / ${formatCH(pk.bb)}`;
  t.addZone(t.body.querySelector('[data-zone="buyin"]'));
  const { seatEls, sitdown, hintLine, rectOf } = pk;
  const readoutLabel = t.root.querySelector('.bet-readout span');
  let opponents = 5;
  t.body.querySelectorAll('[data-opp]').forEach(b => b.addEventListener('click', () => {
    opponents = Number(b.dataset.opp);
    t.body.querySelectorAll('[data-opp]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    sound.tick();
  }));
  const bar = createActionBar(t, pk);
  const { sizer } = bar;

  let session = null; // last server view
  let prompted = ''; // the hand and turn "Your action" was last called for

  async function playEvents(events, view) {
    pk.animating = true;
    refreshActions();
    await pk.playEvents(events, view.table);
  }

  // ---------- server calls ----------
  function apply(res) {
    t.setServerState(res.state);
    session = res.session;
  }

  async function resync(message) {
    if (message) t.toast(message);
    try { const open = await api.holdemOpen(); t.setServerState(open.state); session = open.session; } catch { return; }
    if (session) pk.render(session.table);
    showSeated(Boolean(session));
    await t.syncBalance();
  }

  async function sit() {
    if (!t.betReady) return;
    const buyIn = t.total;
    let res;
    try { res = await api.holdemSit(buyIn, t.tier.floor, opponents); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.lock();
    // The buy-in leaves the cloth and becomes the person's stack.
    apply(res);
    pk.me = 0;
    pk.buildSeats(res.session.table);
    res.session.table.seats.forEach((_, i) => { seatEls[i].cards.replaceChildren(); pk.paintBet(i, 0); });
    showSeated(true);
    const stackChips = [...t.stackOf('buyin').children];
    sound.chips(3);
    await Promise.all(stackChips.map((c, k) => flyTo(c, rectOf(seatEls[0].plate), { duration: 420, delay: k * 25, fade: true })));
    t.emptyZone('buyin');
    await t.syncBalance();
    seatEls.forEach((s, k) => animate(s.node, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: k * 70, fill: 'backwards' }));
    await wait(350);
    await playEvents(res.events, res.session);
    afterEvents();
  }

  async function act(action, amount) {
    if (!session || pk.animating) return;
    const tb = session.table;
    let res;
    try { res = await api.holdemAction(session.id, tb.handNo, tb.seq, action, amount); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    await playEvents(res.events, res.session);
    afterEvents();
  }

  async function next() {
    if (!session || pk.animating) return;
    let res;
    try { res = await api.holdemNext(session.id, session.table.handNo); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    await pk.sweep();
    await playEvents(res.events, res.session);
    afterEvents();
  }

  async function leave() {
    if (!session) return;
    let res;
    try { res = await api.holdemLeave(session.id); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    if (res.events.length) await playEvents(res.events, session);
    await cashOut(session.cashOut ?? 0, session.netPnl ?? 0);
    session = null;
    refreshActions();
  }

  // Whatever is left of the stack flies back to the wallet and the felt is cleared.
  async function cashOut(cash, net) {
    const hero = seatEls[pk.me];
    if (cash > 0 && hero) {
      const values = breakdown(cash, pk.chipSet, 8);
      const from = rectOf(hero.plate);
      sound.chips(4);
      await Promise.all(values.map((v, k) => {
        const c = createChip(v); c.classList.add('pk-flying'); document.body.append(c);
        const r = rectOf(t.balanceEl); c.style.left = `${r.left + r.width / 2}px`; c.style.top = `${r.top + r.height / 2}px`;
        return flyFrom(c, from, { duration: 520, delay: k * 50, lift: 50 }).then(() => c.remove());
      }));
    }
    t.banner(`${cash > 0 ? '일어났어요' : '칩을 모두 잃었어요'}${net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : ''}`, net > 0 ? 'win' : net < 0 ? 'lose' : 'push');
    t.locked = false;
    t.root.classList.remove('is-playing');
    await pk.sweep();
    pk.clear();
    pk.setStakes(t.tier.slug);
    showSeated(false);
    t.refreshBet();
    await t.syncBalance();
  }

  function afterEvents() {
    if (session?.status === 'SETTLED') {
      const s = session;
      session = null;
      return cashOut(s.cashOut ?? 0, s.netPnl ?? 0).then(refreshActions);
    }
    refreshActions();
  }

  // ---------- controls ----------
  function showSeated(on) {
    t.root.classList.toggle('is-seated', on);
    sitdown.hidden = on;
    hintLine.hidden = on;
    readoutLabel.textContent = on ? '내 스택' : '바이인';
    if (on) { t.locked = true; t.root.classList.add('is-playing'); }
  }

  function legal() { return session && session.status === 'SEATED' && !session.table.handOver && session.table.toAct === 0 ? session.table.legal : null; }
  bar.legal = () => (friends.active ? friends.legal() : legal());
  bar.refresh = () => refreshActions();

  function refreshActions() {
    if (friends.active) return friends.refreshActions();
    if (!session) {
      sizer.hidden = true;
      t.setActions(t.idleActions('앉기', sit));
      return;
    }
    const hero = session.table.seats[0];
    t.betEl.textContent = formatCH(hero.stack);
    t.hint('');
    const l = legal();
    if (l && !pk.animating) {
      t.setActions(bar.actions(l, act));
      pk.markTurn(0);
      hintLine.hidden = true;
      const turn = `${session.table.handNo}:${session.table.seq}`;
      if (prompted !== turn) { prompted = turn; voice.say('your-action', { next: true }); }
      return;
    }
    sizer.hidden = true;
    const over = session.table.handOver;
    t.setActions([
      { label: '일어나기', ghost: true, disabled: pk.animating, onClick: leave },
      { label: '다음 핸드', key: '↵', primary: true, disabled: pk.animating || !over, onClick: next }
    ]);
  }
  t.refreshActions = refreshActions;
  t.onBetChange = () => { refreshActions(); friends.onBetChange(); };

  const friends = createFriends(t, pk, bar, { showSeated, cashOut, refreshActions, soloOpen: () => Boolean(session) });
  t.body.querySelector('[data-friends-open]').addEventListener('click', () => { sound.tick(); friends.open(); });

  // Resume a seat left open (reload, network drop) so the locked buy-in is never stranded.
  refreshActions();
  try {
    const open = await api.holdemOpen();
    t.setServerState(open.state);
    if (open.session) {
      session = open.session;
      showSeated(true);
      pk.render(session.table);
      t.toast('앉아 있던 테이블로 돌아왔어요');
    } else await friends.resume();
    await t.syncBalance();
  } catch {}
  refreshActions();
  // Walking away from the solo table cashes the stack out, the way a player takes their chips to the
  // cage; otherwise winnings sat locked at the table and never reached the wallet. A hand still in
  // progress is folded first. The returned promise lets the lobby refresh after the cash-out lands.
  // A friends' room is left open on purpose: reopening Hold'em puts you back in your seat.
  const destroy = t.destroy.bind(t);
  t.destroy = () => {
    friends.stop();
    const open = session && session.status === 'SEATED' ? session.id : null;
    destroy();
    if (!open) return null;
    session = null;
    return api.holdemLeave(open).catch(() => null);
  };
  return t;
}
