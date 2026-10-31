// Texas Hold'em against AI opponents: buy in with chips, cards pitched round the table,
// bets pushed out and raked into the pot, the pot pushed to the winner. The server deals
// and plays the bots; this screen replays its events one by one so every move is visible.
// The felt itself lives in holdem-view.js; "친구와 함께" seats friends at it (holdem-room.js).
import { api, errorMessage } from '../api.js';
import { wait, formatCH, flyFrom, flyTo, animate, sound, el, formatUnit } from '../fx.js';
import { createChip, breakdown } from '../chips.js';
import { Table } from '../table.js';
import { gameName } from '../names.js';
import { voice } from '../voice.js';
import { eventResult } from '../event-result.js';
import { createPokerFelt, createActionBar } from './holdem-view.js';
import { createFriends } from './holdem-room.js';

// `royale` seats the Casino Royale event table (lib/events.mjs): a six-seat tournament against
// named high rollers whose entry is the floor's maximum bet.
// `tourney: 'rounders'` seats 라운더스 헤즈업 the same way: one boss at a time, heads-up.
export async function mountHoldem(ctx, { royale: royaleMode = false, tourney: tourneyMode = null } = {}) {
  let tourney = royaleMode ? 'royale' : tourneyMode;
  let royale = Boolean(tourney);
  const evOf = id => ctx.state?.events?.find(e => e.id === id) || null;
  const t = new Table({ ...ctx, event: !!royale, game: 'holdem', title: royale ? evOf(tourney)?.title || 'Casino Royale' : gameName('poker'), feltClass: `felt--poker${royale ? ` felt--royale felt--${tourney}` : ''}` });
  const pk = createPokerFelt(t, { sitdown: `
    <button type="button" class="zone pk-buyin" data-zone="buyin"><strong>Buy-in</strong><small data-blinds></small></button>
    <div class="pk-opponents" role="radiogroup" aria-label="상대 수">
      <span>상대</span>${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-opp="${n}" aria-checked="${n === 5}">${n}</button>`).join('')}
    </div>
    <button type="button" class="pk-friends-open" data-friends-open>친구와 함께</button>` });
  // The circle says only the minimum; the blinds go under the hint line, so no text runs out of it.
  t.body.querySelector('[data-blinds]').textContent = `최소 ${formatCH(pk.bb * 5)}`;
  pk.hintLine.insertAdjacentHTML('afterend', `<p class="pk-blinds">블라인드 ${formatCH(pk.bb / 2)} / ${formatCH(pk.bb)}</p>`);
  // Five outlines where the flop, turn and river will land, until I sit down.
  t.body.querySelector('[data-board]').insertAdjacentHTML('afterend', `<div class="pk-ghosts" aria-hidden="true">${'<i></i>'.repeat(5)}</div>`);
  const entry = t.tier.max;
  const hud = el('div', 'royale-hud');
  hud.hidden = true;
  t.body.querySelector('.pk').append(hud);
  if (royale) setupRoyale();
  function setupRoyale() {
    t.root.classList.add('is-royale');
    pk.sitdown.querySelector('.royale-entry')?.remove();
    const ev = evOf(tourney);
    const boss = tourney === 'rounders' ? ctx.state?.rounders : null;
    [...pk.sitdown.children].forEach(c => { c.hidden = true; });
    pk.sitdown.insertAdjacentHTML('beforeend', `
      <div class="royale-entry">
        <span class="royale-kicker">${ev?.kicker || ''}</span>
        <strong class="royale-title">${(ev?.title || 'Casino Royale').toUpperCase()}</strong>
        ${boss ? `<span class="royale-boss">${boss.level + 1}단계 보스 · <b>${boss.boss}</b></span>` : ''}
        <span class="royale-buyin"><small>바이인</small>${formatUnit(entry)}</span>
        <ul class="royale-rules">${(ev?.rules || []).map(r => `<li>${r}</li>`).join('')}</ul>
      </div>`);
    pk.hintLine.textContent = tourney === 'rounders' ? '보스가 기다리고 있어요' : tourney === 'whale' ? '세계 최고 부자 다섯 명이 기다리고 있어요' : '하이롤러 다섯 명이 기다리고 있어요';
  }
  // The tournament's state over the felt: level, blinds, who is left, what it pays.
  function paintHud(s) {
    const r = s?.royale;
    hud.hidden = !r;
    if (!r) return;
    hud.innerHTML = `${r.bossName ? `<span>보스 <b>${r.bossName}</b></span>` : ''}<span><b>LV ${r.level}</b> · ${formatCH(s.table.smallBlind)}/${formatCH(s.table.bigBlind)}</span><span>${r.handsToNext}핸드 뒤 ${formatCH(r.next.big)}</span><span>${r.bossName ? '' : `<b>${r.left}/${r.seats}</b> · `}상금 <b>${formatCH(r.prize)}</b></span>`;
  }
  function useBlinds(table) {
    pk.bb = table.bigBlind;
    pk.chipSet = [pk.bb, ...t.tier.chips.filter(v => v > pk.bb)];
  }
  t.addZone(t.body.querySelector('[data-zone="buyin"]'));
  const { seatEls, sitdown, hintLine, rectOf } = pk;
  const readoutLabel = t.root.querySelector('.bet-readout span');
  let opponents = 5;
  t.body.querySelectorAll('[data-opp]').forEach(b => b.addEventListener('click', () => {
    opponents = Number(b.dataset.opp);
    t.body.querySelectorAll('[data-opp]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    sound.tick();
    preview();
  }));
  const bar = createActionBar(t, pk);
  const { sizer } = bar;

  let session = null; // last server view
  let prompted = ''; // the hand and turn "Your action" was last called for

  const ROYALE_EVENTS = new Set(['level', 'rebuy', 'out', 'royale-end']);
  async function playEvents(events, view) {
    pk.animating = true;
    refreshActions();
    if (view.royale) useBlinds(view.table);
    for (const e of events.filter(e => e.t === 'level' || e.t === 'rebuy')) await royaleNote(e);
    // A finished session's table is stored without its last hand: keep the felt as the hand left it.
    await pk.playEvents(events.filter(e => !ROYALE_EVENTS.has(e.t)), view.table, { snap: view.status !== 'SETTLED' });
    for (const e of events.filter(e => e.t === 'out' || e.t === 'royale-end')) await royaleNote(e);
    paintHud(view);
  }
  async function royaleNote(e) {
    if (e.t === 'level') { t.banner(`Level ${e.level}`, 'push'); t.toast(`블라인드가 ${formatCH(e.small)}/${formatCH(e.big)}로 올랐어요`); sound.tick(); await wait(700); }
    else if (e.t === 'rebuy') { t.toast(`리바이 · ${formatCH(e.stack)} 다시 받았어요`); sound.chips(3); }
    else if (e.t === 'out') {
      t.toast(`${e.name} 탈락 · ${e.place}위`);
      await wait(600);
      // Down to the last two of a six-seat tournament: the final.
      if (e.place === 3 && tourney !== 'rounders') { t.banner('HEADS-UP 결승', 'push'); sound.tick(); await wait(900); }
    }
    else if (e.t === 'royale-end') {
      if (e.place === 1) t.banner(tourney === 'rounders' ? '보스 격파' : `${evOf(tourney)?.title || 'Casino Royale'} 우승`, 'win');
      else t.banner(`${e.place}위로 마쳤어요`, 'lose');
      await wait(900);
    }
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
    if (!royale && !t.betReady) return;
    const buyIn = royale ? entry : t.total;
    // Five big blinds deep at least (lib/holdem-session.mjs): 1,000만 at the 100만/200만 tables.
    if (!royale && buyIn < pk.bb * 5) { t.toast(`바이인은 최소 ${formatCH(pk.bb * 5)}이에요 (블라인드 ${formatCH(pk.bb / 2)}/${formatCH(pk.bb)})`); return; }
    let res;
    try { res = await api.holdemSit(buyIn, t.tier.floor, opponents, tourney === 'royale', tourney && tourney !== 'royale' ? tourney : null); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.lock();
    // The buy-in leaves the cloth and becomes the person's stack.
    apply(res);
    pk.me = 0;
    if (res.session.royale) useBlinds(res.session.table);
    pk.buildSeats(res.session.table);
    res.session.table.seats.forEach((_, i) => { seatEls[i].cards.replaceChildren(); pk.paintBet(i, 0); });
    showSeated(true);
    const stackChips = [...t.stackOf('buyin').children];
    sound.chips(3);
    const seat = rectOf(seatEls[0].plate);
    await Promise.all(stackChips.map((c, k) => flyTo(c, seat, { duration: 420, delay: k * 25, fade: true })));
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

  async function rebuy() {
    if (!session) return;
    let res;
    try { res = await api.holdemRebuy(session.id); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    pk.render(session.table);
    await playEvents(res.events, res.session);
    await t.syncBalance();
    afterEvents();
  }

  async function leave() {
    if (!session) return;
    if (session.royale && session.royale.place === null && !confirm('지금 일어나면 기권이에요. 테이블에 있는 칩은 돌려받지 못해요. 그래도 일어날까요?')) return;
    let res;
    try { res = await api.holdemLeave(session.id); }
    catch (e) { await resync(errorMessage(e)); return; }
    apply(res);
    if (res.events.length) await playEvents(res.events, session);
    await cashOut(session.cashOut ?? 0, session.netPnl ?? 0, session.royale);
    session = null;
    refreshActions();
  }

  // Whatever is left of the stack flies back to the wallet and the felt is cleared.
  async function cashOut(cash, net, r = null) {
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
    // The house's event prize on top of the pot: the champion's bonus, the runner-up's buy-in back, the boss bounty.
    const extra = (r?.bonus || 0) + (r?.bounty || 0);
    if (royale && r?.place) {
      // A tournament ends on its own screen: the victory card for a prize, the noir defeat otherwise.
      const title = evOf(r.event || tourney)?.title || 'Casino Royale';
      const event = r.event || tourney;
      const headsUp = event === 'rounders';
      const won = !r.forfeit && (r.place === 1 || (r.place === 2 && !headsUp));
      const detail = r.forfeit ? '기권했어요' : extra > 0 ? `${r.bounty ? '현상금' : r.place === 1 ? '우승 보너스' : '바이인 반환'} ${formatCH(extra)} 포함` : '';
      const amount = won ? (r.place === 1 ? net + extra : extra) : Math.max(0, -net);
      await eventResult({ event, win: won, title, place: headsUp ? null : r.place, amount, detail, nickname: t.nickname });
    } else t.banner(cash > 0 ? '일어났어요' : '칩을 모두 잃었어요', net > 0 ? 'win' : net < 0 ? 'lose' : 'push', net);
    hud.hidden = true;
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
      // Out of chips: the showdown stays on the felt until the player gets up.
      if (!(s.cashOut > 0)) { busted = s; return refreshActions(); }
      return cashOut(s.cashOut ?? 0, s.netPnl ?? 0, s.royale).then(refreshActions);
    }
    refreshActions();
  }
  let busted = null;
  async function getUp() {
    const s = busted; busted = null;
    await cashOut(0, s.netPnl ?? 0, s.royale);
    refreshActions();
  }
  // After the hand, the hero may turn their cards up for the table (a folded hand, or a pot nobody called).
  const canShow = () => !pk.animating && !pk.wasShown(0) && (busted || (session?.table.handOver && session.table.seats[0]?.inHand));
  const showAction = () => (canShow() ? [{ label: '카드 공개', onClick: async () => { await pk.showOff(0, (session || busted)?.table.seats[0]?.cards || []); } }] : []);

  // ---------- controls ----------
  // Before I sit down the chairs I'd play against stand around the oval, dimmed, one per 상대,
  // so the felt shows the table instead of an empty cloth.
  function preview() {
    const seats = t.body.querySelector('[data-seats]');
    if (royale || t.root.classList.contains('is-seated') || friends?.active) { seats.classList.remove('is-preview'); return; }
    pk.me = 0;
    pk.buildSeats({ seats: Array.from({ length: opponents + 1 }, () => ({ kind: 'empty', stack: 0 })) });
    seats.classList.add('is-preview');
  }
  function showSeated(on) {
    t.root.classList.toggle('is-seated', on);
    if (on) t.body.querySelector('[data-seats]').classList.remove('is-preview');
    sitdown.hidden = on;
    hintLine.hidden = on;
    readoutLabel.textContent = on ? '내 스택' : '바이인';
    if (!on) preview();
    if (on) { t.locked = true; t.root.classList.add('is-playing'); }
  }

  function legal() { return session && session.status === 'SEATED' && !session.table.handOver && session.table.toAct === 0 ? session.table.legal : null; }
  bar.legal = () => (friends.active ? friends.legal() : legal());
  bar.street = () => (friends.active ? friends.street() : session?.table.street);
  bar.refresh = () => refreshActions();

  function refreshActions() {
    if (friends.active) return friends.refreshActions();
    if (busted) {
      sizer.hidden = true;
      t.hint('칩을 모두 잃었어요');
      // Busted at a cash table: get up, or buy in again for what you sat down with, in one tap.
      const again = !royale && t.lastBet && t.available >= t.tier.min;
      t.setActions([...showAction(),
        { label: '나가기', key: again ? undefined : '↵', ghost: again, primary: !again, disabled: pk.animating, onClick: getUp },
        ...(again ? [{ label: '같은 바이인으로 다시 앉기', key: '↵', primary: true, disabled: pk.animating, onClick: async () => { await getUp(); await t.rebet(); if (t.betReady) await sit(); } }] : [])]);
      return;
    }
    if (!session) {
      sizer.hidden = true;
      if (royale) t.setActions([{ label: `참가 · ${formatCH(entry)}`, key: '↵', primary: true, disabled: t.available < entry, onClick: sit }]);
      else {
        // Below the minimum buy-in, 앉기 stays off and says what it takes, before any tap.
        const acts = t.idleActions('앉기', sit, { againLabel: '같은 바이인으로 다시 앉기' });
        const min = pk.bb * 5;
        const go = acts.find(a => a.primary);
        if (t.total > 0 && t.total < min && go) {
          go.disabled = true;
          go.label = `앉기 · 최소 ${formatCH(min)}`;
        }
        t.setActions(acts);
      }
      return;
    }
    if (session.royale?.canRebuy) {
      sizer.hidden = true;
      t.hint('칩을 모두 잃었어요. 리바이는 한 번 할 수 있어요');
      t.setActions([
        { label: '기권하고 나가기', ghost: true, disabled: pk.animating, onClick: leave },
        { label: `리바이 · ${formatCH(session.royale.entry)}`, key: '↵', primary: true, disabled: pk.animating || t.available < session.royale.entry, onClick: rebuy }
      ]);
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
      ...(over ? showAction() : []),
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
    if (open.session && (open.session.royale ? open.session.royale.event || 'royale' : null) !== tourney) {
      // The other kind of table is still open: draw it as what it is.
      royale = Boolean(open.session.royale);
      tourney = open.session.royale?.event || (royale ? 'royale' : null);
      t.root.querySelector('.table-name strong').textContent = royale ? evOf(tourney)?.title || 'Casino Royale' : gameName('poker');
      t.felt.classList.remove('felt--royale', 'felt--rounders');
      if (royale) t.felt.classList.add('felt--royale', `felt--${tourney}`);
      if (royale) setupRoyale(); else { t.root.classList.remove('is-royale'); pk.sitdown.querySelector('.royale-entry')?.remove(); [...pk.sitdown.children].forEach(c => { c.hidden = false; }); }
    }
    if (open.session) {
      session = open.session;
      showSeated(true);
      if (session.royale) useBlinds(session.table);
      pk.render(session.table);
      paintHud(session);
      t.toast('앉아 있던 테이블로 돌아왔어요');
    } else await friends.resume();
    await t.syncBalance();
  } catch {}
  refreshActions();
  if (!session) preview();
  // Walking away from the solo table cashes the stack out, the way a player takes their chips to the
  // cage; otherwise winnings sat locked at the table and never reached the wallet. A hand still in
  // progress is folded first. The returned promise lets the lobby refresh after the cash-out lands.
  // A friends' room is left open on purpose: reopening Hold'em puts you back in your seat.
  const destroy = t.destroy.bind(t);
  t.destroy = () => {
    friends.stop();
    // A tournament seat is kept: closing the screen must not forfeit it. Reopening resumes it.
    const open = session && session.status === 'SEATED' && !session.royale ? session.id : null;
    destroy();
    if (!open) return null;
    session = null;
    return api.holdemLeave(open).catch(() => null);
  };
  return t;
}
