// Shared table shell: header, felt, chip tray, bet zones, payouts and the balance readout.
import { animate, flyFrom, flyTo, flyOut, sound, formatCH, formatMoney, moneyResult, rollNumber, el, wait, ms } from './fx.js';
import { createChip, breakdown, holding, TIERS } from './chips.js';
import { ownerEntrance } from './shop.js';
import { bigWin, bigWinLevel, namedWinCounts } from './bigwin.js';

// A hand that loses this many table minimums (two max bets) gets the hard landing.
const OUCH_MIN = 20;
import { errorMessage, newKey } from './api.js';
import { maybeBust } from './bust.js';
import { buzz } from './haptics.js';
import { toast as noticeToast } from './notice.js';
import { rake, pushPay } from './dealer.js';

// The tallest stack drawn under a tray chip; past it a count says how many there are.
const STACK_CAP = 10;

// Narrow phones show the balance as 12억 5천만 so the top bar keeps room for its buttons.
const balanceText = value => formatCH(value);

// Per-device memory of the chip last picked and the last bet placed, per game and table.
const memoryKey = (game, tier, what) => `vegas:${what}:${game}:${tier}`;
function recall(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

// The felt this player wears, as an extra class on the felt ('' for the game's own).
function feltSkin(state, on) {
  const felt = on && state?.user?.cosmetics?.equipped?.felt;
  return felt ? ` felt--skin felt--skin-${String(felt).replace(/^felt-/, '')}` : '';
}

// How fast the finger was moving as it let go (px per ms), over the last few moves.
function flingVelocity(trail) {
  if (trail.length < 2) return { x: 0, y: 0 };
  const a = trail[0], b = trail[trail.length - 1];
  const dt = Math.max(1, b.t - a.t);
  if (dt > 160) { const recent = trail.filter(p => b.t - p.t <= 120); if (recent.length >= 2) return flingVelocity(recent); }
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

export class Table {
  // multi: separate bets per zone. zoneMin: every zone must meet the table minimum (blackjack
  // boxes) rather than the total (chips spread over a roulette layout).
  // hot: whether this table takes part in 핫 딜러 타임 (lib/hot-table.mjs); event tables don't.
  // skin: whether the player's own felt (꾸미기, lib/shop.mjs) may cover this table; slots keep
  // their cabinet. Event tables keep their look too: table.css skips the skin under .is-event
  // and the event felts, so a table that turns into an event mid-visit changes back.
  // backLabel: where the ← goes (the screen this table was opened from). onSwitch: the table name
  // opens the quick switcher (other games, other tables of this one).
  constructor({ mount, game, title, tier, state, onLeave, onSwitch = null, backLabel = '게임 목록으로 나가기', feltClass = '', multi = false, zoneMin = true, zoneWord = '박스당', pushDouble = false, hot = true, skin = true }) {
    this.pushDouble = pushDouble;
    this.tier = TIERS[tier] || TIERS.mid;
    this.game = game;
    this.available = state?.user?.account?.available ?? 0;
    this.nickname = state?.user?.nickname ?? '';
    // Where the day stood when I sat down, for the result on the way out (seatRecap).
    this.seatDay = state?.user?.today ?? null;
    this.title = title;
    this.shownBalance = this.available;
    this.multi = multi;
    this.zoneMin = zoneMin;
    this.zoneWord = zoneWord;
    this.bets = new Map();
    this.history = [];
    this.focus = null;
    this.passive = new Set();
    this.sides = new Set();
    // Coming back to a table, the last bet is ready to repeat and the last chip is still picked.
    const saved = recall(memoryKey(game, this.tier.slug, 'lastbet'));
    // Chips saved before the bet scale changed are dropped rather than replayed.
    const kept = Array.isArray(saved) ? saved.filter(([, chips]) => Array.isArray(chips) && chips.length && chips.every(v => this.tier.chips.includes(v))) : [];
    this.lastBet = kept.length ? new Map(kept) : null;
    const chip = recall(memoryKey(game, this.tier.slug, 'chip'));
    this.selected = this.tier.chips.includes(chip) ? chip : this.tier.chips[0];
    this.zones = new Map();
    this.locked = false;
    this.busy = false;
    this.listeners = [];

    const root = el('div', `table-screen table-screen--${game}`);
    root.dataset.tier = this.tier.slug;
    root.innerHTML = `
      <header class="table-bar">
        <button class="table-back" type="button" aria-label="${backLabel}" title="${backLabel}"><span aria-hidden="true">←</span></button>
        <div class="table-name"><strong><span class="table-title">${title}</span><span class="hot-marker" data-hot hidden></span></strong><span><i>${this.tier.name}</i> · <i>${formatCH(this.tier.min)}–${formatCH(this.tier.max)}원</i></span></div>
        <div class="table-tools">
          <button class="sound-toggle table-icon" type="button" data-sound aria-label="소리 끄기" aria-pressed="true"><span aria-hidden="true">♪</span></button>
        </div>
        <div class="table-balance table-wallet"><span class="sr-only">보유 칩</span><strong data-balance>${balanceText(this.available)}</strong><small>원</small><button class="wallet-plus" type="button" data-wallet-go aria-label="지갑 열기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button></div>
      </header>
      <div class="felt ${feltClass}${feltSkin(state, skin)}" data-felt>
        <div class="felt-print" aria-hidden="true"></div>
        <div class="dealer-rack" data-rack aria-hidden="true"></div>
        <div class="felt-body" data-body></div>
        <div class="banner" data-banner aria-live="assertive"></div>
        <div class="toast" data-toast role="status" aria-live="polite"></div>
      </div>
      <div class="table-controls">
        <div class="bet-readout"><span>베팅</span><strong data-bet>0</strong><small data-hint></small></div>
        <div class="bet-tools" role="group" aria-label="베팅 조절">
          <button class="bet-tool bet-step" type="button" data-tool="less" aria-label="베팅 한 단계 줄이기"><span aria-hidden="true">−</span></button>
          <button class="bet-tool bet-step" type="button" data-tool="more" aria-label="베팅 한 단계 늘리기"><span aria-hidden="true">+</span></button>
          <button class="bet-tool" type="button" data-tool="double" aria-label="베팅 두 배로">×2</button>
          <button class="bet-tool" type="button" data-tool="max" aria-label="최대 베팅">최대</button>
        </div>
        <div class="chip-tray" data-tray role="group" aria-label="칩 선택"></div>
        <div class="action-row" data-actions></div>
      </div>`;
    mount.replaceChildren(root);
    this.root = root;
    this.felt = root.querySelector('[data-felt]');
    this.body = root.querySelector('[data-body]');
    this.rack = root.querySelector('[data-rack]');
    this.tray = root.querySelector('[data-tray]');
    this.actions = root.querySelector('[data-actions]');
    this.balanceEl = root.querySelector('[data-balance]');
    // The wallet pill's + goes to 지갑, the same as on the home screen.
    root.querySelector('[data-wallet-go]').addEventListener('click', () => dispatchEvent(new CustomEvent('vegas:open-wallet')));
    this.betEl = root.querySelector('[data-bet]');
    this.hintEl = root.querySelector('[data-hint]');
    root.querySelector('.table-back').addEventListener('click', () => onLeave?.());
    if (onSwitch) {
      const name = root.querySelector('.table-name');
      name.dataset.switch = '';
      name.setAttribute('role', 'button');
      name.tabIndex = 0;
      name.setAttribute('aria-haspopup', 'dialog');
      name.setAttribute('aria-label', `${title} ${this.tier.name} · 테이블 바꾸기`);
      name.addEventListener('click', () => onSwitch());
      name.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSwitch(); } });
    }
    this.tools = root.querySelectorAll('[data-tool]');
    // − and + move the bet one table minimum at a time; holding either keeps stepping.
    this.holdStep(root.querySelector('[data-tool="less"]'), () => this.step(-1));
    this.holdStep(root.querySelector('[data-tool="more"]'), () => this.step(1));
    root.querySelector('[data-tool="double"]').addEventListener('click', () => this.double());
    root.querySelector('[data-tool="max"]').addEventListener('click', () => this.max());
    this.renderTray();
    this.renderRack();
    this.hotEl = root.querySelector('[data-hot]');
    // Luxury owners walk in with their dearest piece (looks only; lib/shop.mjs never touches odds).
    if (skin) ownerEntrance(state, this.felt);
    this.hotOn = hot;
    this.hotWindows = [];
    this.watchHot(state, { announce: true });
    // Number keys 1–5 pick a chip from the tray, left to right.
    this.onKey(e => {
      if (e.ctrlKey || e.metaKey || e.altKey || this.locked || this.busy) return;
      const value = this.tier.chips[Number(e.key) - 1];
      if (!value || !this.tray.offsetParent) return;
      this.select(value);
      sound.tick();
    });
  }

  // ---------- layout ----------
  renderRack() {
    const denoms = [...this.tier.chips].reverse();
    this.rack.replaceChildren(...denoms.map(v => {
      const col = el('div', 'rack-col');
      for (let i = 0; i < 5; i++) { const c = createChip(v); c.style.setProperty('--i', i); col.append(c); }
      return col;
    }));
  }

  // Each tray chip sits on top of my own stack of that chip: what I hold, sorted by colour the
  // way chips sit in front of a player. The stacks follow the balance as I bet and get paid.
  renderTray() {
    this.tray.replaceChildren(...this.tier.chips.map(value => {
      const slot = el('div', 'tray-slot');
      const chip = createChip(value, 'button');
      chip.type = 'button';
      chip.setAttribute('aria-label', `${formatCH(value)} 칩`);
      chip.setAttribute('aria-pressed', String(value === this.selected));
      this.bindChip(chip, value);
      const stack = el('span', 'tray-stack');
      stack.setAttribute('aria-hidden', 'true');
      slot.append(chip, stack, el('span', 'tray-count'));
      return slot;
    }));
    this.paintStacks(this.shownBalance);
  }

  paintStacks(balance) {
    const counts = holding(balance, this.tier.chips);
    this.tray.querySelectorAll('.tray-slot').forEach((slot, k) => {
      const value = this.tier.chips[k], n = counts[k];
      const shown = Math.min(n, STACK_CAP);
      const stack = slot.querySelector('.tray-stack');
      const under = Math.max(0, shown - 1);
      while (stack.children.length > under) stack.lastChild.remove();
      while (stack.children.length < under) {
        const c = createChip(value);
        delete c.dataset.value;
        c.style.setProperty('--i', stack.children.length);
        stack.append(c);
      }
      slot.style.setProperty('--n', under);
      slot.classList.toggle('is-empty', n === 0);
      slot.classList.toggle('is-short', value > balance);
      slot.querySelector('.tray-count').textContent = n > STACK_CAP ? `×${formatCH(n)}` : '';
      slot.title = `${formatCH(value)} 칩 ${n.toLocaleString('ko-KR')}개`;
    });
  }

  // Tap a chip to bet it on the spot in play; drag it onto a spot; or flick it up toward a spot
  // and let go, and it is tossed there the way players toss chips to the dealer.
  bindChip(chip, value) {
    let start = null, ghost = null, trail = [];
    chip.addEventListener('pointerdown', e => {
      if (this.locked || this.busy) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      trail = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
      // Keep the finger (or mouse) on this chip even when a quick flick leaves it at once.
      try { chip.setPointerCapture(e.pointerId); } catch {}
    });
    chip.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
        chip.setPointerCapture(e.pointerId);
        ghost = createChip(value);
        ghost.classList.add('chip-ghost');
        document.body.append(ghost);
        this.select(value);
      }
      if (ghost) {
        trail.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
        if (trail.length > 6) trail.shift();
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        const zone = this.zoneAt(e.clientX, e.clientY) || this.flingTarget(e.clientX, e.clientY, flingVelocity(trail));
        this.zones.forEach(z => z.classList.toggle('is-hover', z === zone));
      }
    });
    const end = e => {
      if (!start) return;
      const dragged = Boolean(ghost);
      if (ghost) {
        const dropped = this.zoneAt(e.clientX, e.clientY);
        const v = flingVelocity(trail);
        const zone = dropped || this.flingTarget(e.clientX, e.clientY, v, { release: true });
        const rect = ghost.getBoundingClientRect();
        ghost.remove(); ghost = null;
        this.zones.forEach(z => z.classList.remove('is-hover'));
        if (zone && e.type === 'pointerup') this.addChip(zone.dataset.zone, value, rect, dropped ? undefined : { thrown: Math.hypot(v.x, v.y) });
      }
      start = null; trail = [];
      if (!dragged && e.type === 'pointerup') this.tapChip(value, chip);
    };
    chip.addEventListener('pointerup', end);
    chip.addEventListener('pointercancel', end);
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.tapChip(value, chip); } });
  }

  // Where a flicked chip goes: the open spot closest to the line it was thrown along, ahead of
  // the finger. A slow drag that ends off any spot (`release`) is not a throw.
  flingTarget(x, y, v, { release = false } = {}) {
    const speed = Math.hypot(v.x, v.y);
    if (speed < (release ? 0.55 : 0.8) || v.y > -0.25) return null;
    const ux = v.x / speed, uy = v.y / speed;
    let best = null, score = Infinity;
    this.zones.forEach((node, id) => {
      if (this.passive.has(id) || node.disabled || !node.offsetParent) return;
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2 - x, cy = r.top + r.height / 2 - y;
      const ahead = cx * ux + cy * uy;
      if (ahead <= 0) return;
      const off = Math.abs(cx * uy - cy * ux);
      if (off > Math.max(70, ahead * 0.45)) return;
      const s = off + ahead * 0.15;
      if (s < score) { score = s; best = node; }
    });
    return best;
  }

  zoneAt(x, y) {
    const hit = document.elementsFromPoint(x, y).find(n => n.closest?.('[data-zone]'));
    const zone = hit?.closest('[data-zone]');
    return zone && this.zones.has(zone.dataset.zone) && !this.passive.has(zone.dataset.zone) && !zone.disabled ? zone : null;
  }

  select(value) {
    this.selected = value;
    remember(memoryKey(this.game, this.tier.slug, 'chip'), value);
    this.tray.querySelectorAll('button.chip').forEach(c => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === value)));
  }

  tapChip(value, chip) {
    if (this.locked || this.busy) return;
    this.select(value);
    const target = this.maxZone;
    if (target) this.addChip(target, value, chip.getBoundingClientRect());
    else { sound.tick(); this.hint('베팅할 곳을 탭하세요'); this.zones.forEach(z => animate(z, [{ boxShadow: '0 0 0 0 rgba(255,215,120,0)' }, { boxShadow: '0 0 0 4px rgba(255,215,120,.55)' }, { boxShadow: '0 0 0 0 rgba(255,215,120,0)' }], { duration: 700, fill: 'none' })); }
  }

  // ---------- zones ----------
  // Every zone keeps its own chips. Single-bet games move the whole bet when another zone is
  // picked; multi-zone tables (blackjack boxes) keep a separate bet on each zone.
  // A `side` zone (a side bet) is optional and has no table minimum.
  addZone(node, { passive = false, side = false } = {}) {
    const id = node.dataset.zone;
    if (!node.querySelector('.bet-stack')) node.append(el('span', 'bet-stack'));
    this.zones.set(id, node);
    if (side) this.sides.add(id);
    if (passive) { this.passive.add(id); return node; }
    node.addEventListener('click', () => {
      if (this.locked || this.busy) return;
      this.addChip(id, this.selected, this.tray.querySelector(`[data-value="${this.selected}"]`)?.getBoundingClientRect());
    });
    return node;
  }

  stackOf(zoneId) { return this.zones.get(zoneId)?.querySelector('.bet-stack'); }
  chipsOf(zoneId) { return this.bets.get(zoneId) || []; }
  zoneTotal(zoneId) { return this.chipsOf(zoneId).reduce((a, b) => a + b, 0); }
  get total() { let sum = 0; this.bets.forEach(chips => { sum += chips.reduce((a, b) => a + b, 0); }); return sum; }
  get betZones() { return [...this.zones.keys()].filter(z => this.chipsOf(z).length && !this.passive.has(z)); }
  // Compatibility view for single-bet games: the zone holding the bet and its chips.
  get bet() { const zone = this.betZones[0] || null; return { zone, chips: zone ? [...this.chipsOf(zone)] : [] }; }

  setFocus(zoneId) {
    this.focus = zoneId;
    if (this.multi) this.zones.forEach((z, id) => z.classList.toggle('is-focus', id === zoneId));
  }

  async addChip(zoneId, value, fromRect, { thrown = 0 } = {}) {
    if (this.locked || this.busy) return;
    if (!this.multi) { const held = this.bet.zone; if (held && held !== zoneId) await this.moveBet(held, zoneId); }
    this.setFocus(zoneId);
    if (this.zoneTotal(zoneId) + value > this.tier.max) return this.reject(`${this.multi ? this.zoneWord : '이 테이블'} 최대 베팅은 ${formatCH(this.tier.max)}이에요`);
    if (this.total + value > this.available) return this.reject('칩이 부족해요');
    this.record(zoneId, value);
    const chip = this.pushChip(zoneId, value);
    this.refreshBet();
    if (thrown) {
      // A toss: higher arc and a spin that grows with how hard it was flicked, then it lands.
      buzz('chipThrow');
      const spin = Math.min(720, 240 + thrown * 260) * (Math.random() < 0.5 ? -1 : 1);
      await flyFrom(chip, fromRect, { duration: 480, lift: 90, scale: 1.25, spin, easing: 'cubic-bezier(.3,.6,.35,1)' });
      sound.chip();
      animate(chip, [{ transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }], { duration: 120, fill: 'none' });
      return;
    }
    sound.chip(); buzz('chip');
    if (fromRect) await flyFrom(chip, fromRect, { duration: 380, lift: 60, scale: 1.1, spin: 40 });
  }

  record(zoneId, value) {
    if (!this.bets.has(zoneId)) this.bets.set(zoneId, []);
    this.bets.get(zoneId).push(value);
    this.history.push(zoneId);
  }

  pushChip(zoneId, value) {
    const stack = this.stackOf(zoneId);
    const chip = createChip(value);
    chip.style.setProperty('--i', stack.children.length);
    chip.style.setProperty('--jx', `${(Math.random() * 4 - 2).toFixed(1)}px`);
    stack.append(chip);
    this.zones.get(zoneId).classList.add('has-bet');
    return chip;
  }

  async moveBet(fromId, toId) {
    const fromStack = this.stackOf(fromId);
    const rects = [...fromStack.children].map(c => c.getBoundingClientRect());
    fromStack.replaceChildren();
    this.zones.get(fromId).classList.remove('has-bet');
    const chips = this.chipsOf(fromId);
    this.bets.delete(fromId);
    this.bets.set(toId, chips);
    this.history = this.history.map(z => z === fromId ? toId : z);
    const nodes = chips.map(v => this.pushChip(toId, v));
    sound.chips(2);
    await Promise.all(nodes.map((c, i) => flyFrom(c, rects[i], { duration: 320, delay: i * 25 })));
  }

  // Replace a zone's chips with the fewest chips that make `amount`.
  restack(zoneId, amount) {
    this.stackOf(zoneId).replaceChildren();
    this.history = this.history.filter(z => z !== zoneId);
    this.bets.delete(zoneId);
    this.zones.get(zoneId).classList.remove('has-bet');
    for (const v of breakdown(amount, this.tier.chips, 20)) { this.record(zoneId, v); this.pushChip(zoneId, v); }
  }

  emptyZone(zoneId) {
    this.stackOf(zoneId)?.replaceChildren();
    this.bets.delete(zoneId);
    this.history = this.history.filter(z => z !== zoneId);
    this.zones.get(zoneId)?.classList.remove('has-bet');
  }

  async clearBet({ animateBack = true } = {}) {
    const stacks = [...this.bets.keys()].map(z => this.stackOf(z)).filter(Boolean);
    const target = this.tray.getBoundingClientRect();
    if (animateBack && stacks.length) { sound.chips(2); await Promise.all(stacks.flatMap(s => [...s.children]).map((c, i) => flyTo(c, target, { duration: 320, delay: i * 20, fade: true }))); }
    [...this.bets.keys()].forEach(z => this.emptyZone(z));
    this.history = [];
    this.refreshBet();
  }

  // ---------- fine bet adjustments ----------
  async double() {
    if (this.locked || this.busy || !this.total) return;
    const tray = this.tray.getBoundingClientRect();
    let added = 0, blocked = '';
    for (const zoneId of this.betZones) {
      const now = this.zoneTotal(zoneId);
      const room = Math.min(this.tier.max - now, this.available - this.total);
      const want = Math.min(now, room);
      if (want < now) blocked = room === this.tier.max - now ? `${this.multi ? this.zoneWord : '이 테이블'} 최대 베팅은 ${formatCH(this.tier.max)}이에요` : '칩이 부족해요';
      let sum = 0;
      for (const v of breakdown(want, this.tier.chips, 20)) {
        if (sum + v > want) break;
        sum += v; added += v;
        this.record(zoneId, v);
        const chip = this.pushChip(zoneId, v);
        sound.chip();
        flyFrom(chip, tray, { duration: 320, lift: 40 });
        await wait(50);
      }
    }
    if (!added) return this.reject(blocked || '칩이 부족해요');
    if (blocked) this.toast(blocked);
    this.refreshBet();
  }

  // One step down or up on the bet in play (the focused zone, or the one bet on the felt), a
  // table minimum at a time. Stepping down from the minimum takes the bet off; stepping up on an
  // empty table puts the minimum down.
  async step(dir) {
    if (this.locked || this.busy) return false;
    const zoneId = this.maxZone;
    if (!zoneId) { this.hint('베팅할 곳을 탭하세요'); return false; }
    const unit = Math.min(...this.tier.chips);
    const floor = this.sides.has(zoneId) || !this.zoneMin ? unit : this.tier.min;
    const now = this.zoneTotal(zoneId);
    if (dir < 0) {
      if (!now) return false;
      const target = now - unit < floor ? 0 : Math.floor((now - unit) / unit) * unit;
      sound.chip(); buzz('step');
      if (target) this.restack(zoneId, target);
      else {
        const stack = this.stackOf(zoneId);
        const tray = this.tray.getBoundingClientRect();
        await Promise.all([...stack.children].map(c => flyTo(c, tray, { duration: 260, fade: true })));
        this.emptyZone(zoneId);
      }
      this.refreshBet();
      return Boolean(target);
    }
    const target = now ? Math.floor(now / unit) * unit + unit : Math.max(floor, unit);
    if (target > this.tier.max) { this.reject(`${this.multi ? this.zoneWord : '이 테이블'} 최대 베팅은 ${formatCH(this.tier.max)}이에요`); return false; }
    if (this.total - now + target > this.available) { this.reject('칩이 부족해요'); return false; }
    this.setFocus(zoneId);
    this.restack(zoneId, target);
    sound.chip(); buzz('step');
    const top = this.stackOf(zoneId).lastElementChild;
    if (top) flyFrom(top, this.tray.getBoundingClientRect(), { duration: 260, lift: 30 });
    this.refreshBet();
    return true;
  }

  // Press and hold: one step at once, then a step every ~110ms after a short pause.
  holdStep(button, run) {
    let timer = null;
    const stop = () => { clearTimeout(timer); timer = null; };
    const tick = async (delay) => { if (await run() !== false && timer !== null) timer = setTimeout(() => tick(110), delay); else stop(); };
    let pressed = false;
    button.addEventListener('pointerdown', e => { if (button.disabled || e.button > 0) return; pressed = true; stop(); timer = 0; tick(380); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => button.addEventListener(t, stop));
    // Keyboard and screen readers click without a pointer: one step per click.
    button.addEventListener('click', () => { if (pressed) { pressed = false; return; } run(); });
    button.addEventListener('contextmenu', e => e.preventDefault());
  }

  // The zone the 최대 button fills: the focused zone, the bet already down, or the only zone.
  get maxZone() {
    const open = [...this.zones.keys()].filter(z => !this.passive.has(z));
    if (this.multi) return this.focus || (this.zoneMin ? open[0] : null) || null;
    return this.bet.zone || (open.length === 1 ? open[0] : null);
  }

  async max() {
    if (this.locked || this.busy) return;
    const zoneId = this.maxZone;
    if (!zoneId) { this.hint('베팅할 곳을 탭하세요'); return; }
    const step = Math.min(...this.tier.chips);
    const room = this.available - (this.total - this.zoneTotal(zoneId));
    const target = Math.floor(Math.min(this.tier.max, room) / step) * step;
    if (target < this.tier.min) return this.reject('칩이 부족해요');
    if (target === this.zoneTotal(zoneId)) return;
    this.setFocus(zoneId);
    this.restack(zoneId, target);
    sound.chips(3); buzz('chip');
    const tray = this.tray.getBoundingClientRect();
    [...this.stackOf(zoneId).children].forEach((c, i) => flyFrom(c, tray, { duration: 340, delay: i * 30, lift: 40 }));
    this.refreshBet();
  }

  async rebet() {
    if (!this.lastBet) return;
    await this.clearBet({ animateBack: false });
    const tray = this.tray.getBoundingClientRect();
    let short = false;
    for (const [zoneId, chips] of this.lastBet) {
      if (!this.zones.has(zoneId)) continue;
      for (const v of chips) {
        if (this.zoneTotal(zoneId) + v > this.tier.max || this.total + v > this.available) { short = true; break; }
        this.record(zoneId, v);
        flyFrom(this.pushChip(zoneId, v), tray, { duration: 340, lift: 50 });
        sound.chip();
        await wait(45);
      }
      this.setFocus(zoneId);
    }
    if (short) this.toast('칩이 부족해 일부만 다시 놓았어요');
    this.refreshBet();
  }

  // Extra chips pushed out for a double, split or insurance.
  async addFromTray(zoneId, amount) {
    const values = breakdown(amount, this.tier.chips, 6);
    const tray = this.tray.getBoundingClientRect();
    for (const v of values) {
      const chip = this.pushChip(zoneId, v);
      sound.chip();
      await flyFrom(chip, tray, { duration: 300, lift: 50 });
    }
    if (!this.bets.has(zoneId)) this.bets.set(zoneId, []);
    this.bets.get(zoneId).push(amount);
    this.refreshBet();
  }

  // Put chips for a bet that is already locked on the server (resuming a round).
  placeLocked(zoneId, amount) {
    if (!this.bets.has(zoneId)) this.bets.set(zoneId, []);
    this.bets.get(zoneId).push(amount);
    for (const v of breakdown(amount, this.tier.chips, 8)) this.pushChip(zoneId, v);
  }

  // Sweep one zone's chips to the house before the round ends (a lost insurance bet).
  async rakeZone(zoneId) {
    const stack = this.stackOf(zoneId);
    if (!stack?.children.length) return;
    await rake([...stack.children], this.rack.getBoundingClientRect());
    this.emptyZone(zoneId);
    this.refreshBet();
  }

  refreshBet() {
    this.betEl.textContent = formatCH(this.total);
    const zones = this.betZones;
    const main = zones.filter(z => !this.sides.has(z));
    const mainTotal = main.reduce((n, z) => n + this.zoneTotal(z), 0);
    const short = this.zoneMin ? main.some(z => this.zoneTotal(z) < this.tier.min) : mainTotal > 0 && mainTotal < this.tier.min;
    this.hint(short ? `${this.multi && this.zoneMin && main.length > 1 ? '박스마다 ' : this.zoneMin ? '' : '합계 '}최소 ${formatCH(this.tier.min)}` : '');
    if (this.multi) this.zones.forEach((node, id) => {
      const tag = node.querySelector('.zone-amount');
      if (tag) tag.textContent = this.zoneTotal(id) ? formatCH(this.zoneTotal(id)) : '';
    });
    if (!this.locked) this.setBalance(this.available - this.total, { roll: false });
    const empty = !this.total;
    this.tools.forEach(b => { b.disabled = b.dataset.tool === 'max' || b.dataset.tool === 'more' ? !this.maxZone : b.dataset.tool === 'less' ? !(this.maxZone && this.zoneTotal(this.maxZone)) : empty; });
    this.onBetChange?.();
  }

  get betReady() {
    const zones = this.betZones;
    const main = zones.filter(z => !this.sides.has(z));
    const enough = this.zoneMin ? main.every(z => this.zoneTotal(z) >= this.tier.min) : main.reduce((n, z) => n + this.zoneTotal(z), 0) >= this.tier.min;
    return main.length > 0 && this.total <= this.available && enough && zones.every(z => this.zoneTotal(z) <= this.tier.max);
  }

  // Idle action row shared by every game: clear, rebet, and the primary deal/spin/roll.
  // With nothing on the felt after a round, the primary button replays the last bet in one tap.
  // againLabel names the one-tap repeat where "같은 베팅으로 <label>" would read oddly.
  idleActions(label, go, { againLabel = `같은 베팅으로 ${label}` } = {}) {
    const again = !this.total && this.lastBet;
    // After a push: leave the chips where they were and double them for the next hand.
    if (again && this.pushed && this.pushDouble) return [
      { label: `같은 베팅으로 ${label}`, ghost: true, onClick: async () => { this.pushed = false; await this.rebet(); if (this.betReady) await go(); } },
      { label: '묻고 더블로 가 ×2', key: '↵', primary: true, onClick: async () => { this.pushed = false; await this.rebet(); await this.double(); if (this.betReady) await go(); } }
    ];
    if (again) return [
      { label: '다시 베팅', ghost: true, onClick: () => this.rebet() },
      { label: againLabel, key: '↵', primary: true, onClick: async () => { await this.rebet(); if (this.betReady) await go(); } }
    ];
    return [
      { label: '지우기', ghost: true, disabled: !this.total, onClick: () => this.clearBet() },
      { label, key: '↵', primary: true, disabled: !this.betReady, onClick: go }
    ];
  }

  // Enter runs whatever the primary idle button does right now.
  enterAction() { return this.actionList?.find(a => a.key === '↵' && !a.disabled) || null; }

  reject(message) {
    sound.tick(); buzz('reject');
    animate(this.betEl.parentElement, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260, fill: 'none' });
    this.toast(message);
  }

  hint(text) { this.hintEl.textContent = text; }

  // ---------- round lifecycle ----------
  lock() {
    this.locked = true;
    this.root.classList.add('is-playing');
    this.lastBet = new Map(this.betZones.map(z => [z, [...this.chipsOf(z)]]));
    if (this.lastBet.size) remember(memoryKey(this.game, this.tier.slug, 'lastbet'), [...this.lastBet]);
  }

  // Resolve the bets on the felt: winnings slide in from the rack, losses get raked away.
  // `zones` maps zone id to its own net; without it the whole net belongs to the one bet.
  // `big` names a moment worth stopping the table for ({ title, subtitle }), shown once it paid a
  // max bet's worth; any win of 25 table minimums (and double the stake) gets one anyway
  // (public/js/bigwin.js). `big: false` keeps the table going whatever was won.
  // `hot` is the round's 핫 테이블 bonus ({ bonus, rate }), already counted in `net`.
  async settle(net, { label, kind, zones, big, hot } = {}) {
    const staked = this.total;
    const held = [...this.bets.keys()].filter(z => this.chipsOf(z).length);
    const nets = zones || new Map([[held[0], net]]);
    // A stand-off (blackjack push, baccarat tie on a player/banker bet) offers 묻고 더블로 가.
    this.pushed = staked > 0 && net === 0 && [...nets.values()].every(n => !n);
    const rack = this.rack.getBoundingClientRect();
    const pays = [];
    nets.forEach((n, zoneId) => {
      const stack = this.stackOf(zoneId);
      if (!(n > 0) || !stack) return;
      const payStack = el('span', 'bet-stack bet-stack--payout');
      stack.after(payStack);
      // Pay in smaller chips so a win lands as a handful, not a single disc.
      const small = this.tier.chips.filter(v => v <= n / 4);
      breakdown(n, small.length ? small : this.tier.chips, 12).forEach((v, i) => {
        const c = createChip(v); c.style.setProperty('--i', i); payStack.append(c);
      });
      // The dealer cuts the stack at the rack and slides it over, one box after another.
      pays.push(pushPay(payStack, rack, { delay: pays.length * 260 }));
    });
    if (pays.length) await Promise.all(pays);
    // A loss of two max bets or more in one hand lands hard: the felt flashes red and shakes.
    const ouch = net < 0 && -net >= OUCH_MIN * this.tier.min;
    const day = this.dayNews(net);
    if (label || net) this.banner(label || '', kind || (net > 0 ? 'win' : net < 0 ? (ouch ? 'lose banner--ouch' : 'lose') : 'push'), net, hot?.bonus > 0 ? `핫 테이블 +${Math.round(hot.rate * 100)}% · +${formatMoney(hot.bonus)}` : '', net < 0 ? day : '');
    if (net > 0) { sound.win(); buzz('win'); this.glow(); }
    else if (net < 0) { sound.lose(); buzz(ouch ? 'ouch' : 'lose'); if (ouch) this.ouch(); }
    else { sound.push(); buzz('push'); }
    if (big !== false && net > 0) {
      const level = bigWinLevel(net, staked, this.tier.min);
      const multiple = staked > 0 ? Math.floor(net / staked) : 0;
      if (big && (big.force || namedWinCounts(net, this.tier.min))) await this.bigWin(net, { ...big, level: Math.max(1, level), multiple, force: true });
      else if (level) await this.bigWin(net, { title: multiple >= 2 ? `${multiple}×` : '대박', level, multiple, force: true });
    }
    await wait(net > 0 ? 900 : 650);
    const moves = [], raked = [];
    const balance = this.balanceEl.getBoundingClientRect();
    new Set([...held, ...nets.keys()]).forEach(zoneId => {
      const node = this.zones.get(zoneId);
      if (!node) return;
      const lost = (nets.get(zoneId) ?? 0) < 0;
      node.querySelectorAll('.bet-stack .chip').forEach(c => lost
        ? raked.push(c)
        : moves.push(flyOut(c, balance, { duration: 520, delay: moves.length * 40, lift: 60, onLand: () => this.catchChips() })));
    });
    // Lost chips are raked in one sweep; what I won comes home to the wallet.
    if (moves.length) sound.chips(3);
    if (raked.length) moves.push(rake(raked, rack));
    await Promise.all(moves);
    this.resetRound();
  }

  // Clears the felt and unlocks betting; games that move their own chips call this directly.
  resetRound() {
    this.zones.forEach(z => z.querySelectorAll('.bet-stack--payout').forEach(s => s.remove()));
    [...this.zones.keys()].forEach(z => this.emptyZone(z));
    this.history = [];
    this.locked = false;
    this.root.classList.remove('is-playing');
    this.refreshBet();
    maybeBust(this.serverState);
    this.idleDue = true;
    setTimeout(() => this.maybeIdle(), 0);
  }

  // Once a round is over and nothing is moving, the app may move the player to another table
  // (app.js tableAfterRound). A round that starts straight after its reset keeps it waiting.
  maybeIdle() {
    if (!this.idleDue || this.busy || this.locked || !this.root.isConnected) return;
    this.idleDue = false;
    this.onIdle?.(this.serverState);
  }

  // "테이블을 바꿨어요": a card at the top of the felt saying where the player was moved and why.
  moved(title, reason) {
    this.felt.querySelector('.table-moved')?.remove();
    const node = el('div', 'table-moved');
    node.setAttribute('role', 'status');
    node.innerHTML = `<span class="table-moved-eyebrow">테이블을 바꿨어요</span><strong></strong><small></small>`;
    node.querySelector('strong').textContent = title;
    node.querySelector('small').textContent = reason;
    const hide = () => { node.classList.remove('is-shown'); setTimeout(() => node.remove(), 400); };
    node.addEventListener('click', hide);
    this.felt.append(node);
    requestAnimationFrame(() => node.classList.add('is-shown'));
    sound.tick();
    setTimeout(hide, 5200);
  }

  setServerState(state) {
    if (state?.user?.account) this.available = state.user.account.available;
    // A bust or a 구제금융 shows once the round on the felt is over, not while its cards are dealt.
    this.serverState = state;
    if (!this.locked) maybeBust(state);
    this.watchHot(state);
  }

  // ---------- 핫 딜러 타임 ----------
  // The "HOT" marker by the title and its countdown, while this game is the hot table. The
  // windows come with every server state; the clock is corrected by the server's time.
  watchHot(state, { announce = false } = {}) {
    if (!this.hotOn || !state) return;
    if (state.serverTime) this.clockSkew = Date.parse(state.serverTime) - Date.now();
    this.hotWindows = [state.hotTable, state.hotNext].filter(w => w && w.game === this.game);
    if (!this.hotTimer) {
      this.hotTimer = setInterval(() => this.paintHot(), 1000);
      this.listeners.push(['hot-timer', this.hotTimer]);
    }
    const live = this.paintHot();
    if (announce && live) setTimeout(() => this.toast(`핫 딜러 타임 · 이기면 순수익 +${Math.round(live.bonus * 100)}%`), 400);
  }

  paintHot() {
    const now = Date.now() + (this.clockSkew || 0);
    const live = this.hotWindows.find(w => now >= Date.parse(w.startsAt) && now < Date.parse(w.endsAt));
    const node = this.hotEl;
    node.hidden = !live;
    this.root.classList.toggle('is-hot', Boolean(live));
    if (!live) return null;
    const left = Math.max(0, Math.ceil((Date.parse(live.endsAt) - now) / 1000));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const pct = Math.round(live.bonus * 100);
    if (!node.firstChild) node.innerHTML = '<b>HOT</b><span class="hot-pct"></span><span data-hot-clock></span>';
    node.querySelector('.hot-pct').textContent = `+${pct}%`;
    node.querySelector('[data-hot-clock]').textContent = clock;
    node.setAttribute('aria-label', `핫 테이블, 이기면 순수익 ${pct}% 추가, ${Math.floor(left / 60)}분 ${left % 60}초 남음`);
    node.title = `핫 딜러 타임: 이기면 순수익의 ${pct}%를 더 받아요 (베팅액까지)`;
    return live;
  }

  async setBalance(value, { roll = true } = {}) {
    const from = this.shownBalance;
    this.shownBalance = value;
    this.paintStacks(value);
    if (roll) {
      this.balanceEl.parentElement.classList.toggle('is-up', value > from);
      this.balanceEl.parentElement.classList.toggle('is-down', value < from);
      await rollNumber(this.balanceEl, from, value, { format: balanceText });
      setTimeout(() => this.balanceEl.parentElement.classList.remove('is-up', 'is-down'), ms(600));
    } else this.balanceEl.textContent = balanceText(value);
    this.balanceEl.parentElement.title = formatMoney(value);
  }

  // The wallet answers each chip that lands in it: a small bounce, and the count starts rolling up.
  catchChips() {
    const box = this.balanceEl.parentElement;
    animate(box, [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    if (!this.catching) { this.catching = true; this.syncBalance().finally(() => { this.catching = false; }); }
  }

  syncBalance() { return this.setBalance(this.available - (this.locked ? 0 : this.total)); }

  // ---------- feedback ----------
  // The headline, and under it what the round was worth: "7억 2천만원 벌었어요".
  // day: the day's running loss under a losing hand ("오늘 -12억 · 3연패").
  banner(text, kind = 'win', net = 0, extra = '', day = '') {
    const node = this.root.querySelector('[data-banner]');
    node.className = `banner banner--${kind} is-shown`;
    node.replaceChildren();
    if (text) node.append(el('span', 'banner-head', text));
    if (net) node.append(el('span', 'banner-money', moneyResult(net)));
    if (extra) node.append(el('span', 'banner-hot', extra));
    if (day) node.append(el('span', `banner-day${this.dayStreak >= 5 ? ' is-burning' : this.dayStreak >= 3 ? ' is-streak' : ''}`, day));
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => node.classList.remove('is-shown'), ms(day ? 2300 : 1800));
  }

  // ---------- 오늘의 손익 ----------
  // The day's won/lost from the server (lib/loss-tally.mjs), once it counts the round just
  // played: a tag under the wallet after every round, and a line on every losing banner.
  // 한서 (2026-10-27): "얼마 잃었는지 보여주는 게 좀 많았으면".
  dayNews(net) {
    const d = this.serverState?.user?.today;
    if (!d || !net || d.rounds === this.dayRounds) return '';
    this.dayRounds = d.rounds;
    this.dayTag(d.net);
    if (net > 0) return '';
    const parts = [d.net < 0 ? `오늘 -${formatCH(-d.net)}` : `오늘 잃은 돈 -${formatCH(d.lost)}`];
    if (d.losingRun >= 2) parts.push(`${d.losingRun}연패`);
    this.dayStreak = d.losingRun || 0;
    this.lossMilestone(d);
    return parts.join(' · ');
  }

  // The day's loss passing 50, 100, 200, 500 or 1000 table minimums gets said out loud, once.
  lossMilestone(d) {
    if (!(d.net < 0)) return;
    const lost = -d.net, min = this.tier.min;
    const mark = [1000, 500, 200, 100, 50].find(k => lost >= k * min);
    const key = `${d.day}:${this.tier.slug}`;
    if (!mark || (this.lossMark?.key === key && this.lossMark.mark >= mark)) return;
    this.lossMark = { key, mark };
    setTimeout(() => this.toast(`오늘 ${formatCH(lost)} 잃었어요 · 이 테이블 최대 베팅 ${Math.floor(lost / this.tier.max)}판어치`), ms(2400));
  }

  dayTag(net) {
    const box = this.balanceEl.parentElement;
    let tag = box.querySelector('.day-tag');
    if (!tag) { tag = el('span', 'day-tag'); tag.setAttribute('aria-hidden', 'true'); box.append(tag); }
    tag.textContent = `오늘 ${net < 0 ? '-' : net > 0 ? '+' : ''}${formatCH(Math.abs(net))}`;
    tag.className = `day-tag ${net < 0 ? 'is-down' : net > 0 ? 'is-up' : ''} is-shown`;
    clearTimeout(this.dayTimer);
    this.dayTimer = setTimeout(() => tag.classList.remove('is-shown'), ms(3200));
  }

  ouch() {
    this.root.classList.remove('is-ouch');
    void this.root.offsetWidth;
    this.root.classList.add('is-ouch');
    clearTimeout(this.ouchTimer);
    this.ouchTimer = setTimeout(() => this.root.classList.remove('is-ouch'), ms(900));
  }

  // action/onAction: one button in the toast (다시 시도); it then stays up a little longer.
  toast(text, { action = '', onAction = null } = {}) {
    const node = this.root.querySelector('[data-toast]');
    node.textContent = text;
    node.classList.toggle('has-action', Boolean(action && onAction));
    if (action && onAction) {
      const b = el('button', 'toast-action', action);
      b.type = 'button';
      b.addEventListener('click', () => { node.classList.remove('is-shown', 'has-action'); onAction(); });
      node.append(b);
    }
    node.classList.add('is-shown');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => node.classList.remove('is-shown', 'has-action'), action ? 7000 : 2600);
  }

  // ---------- instant rounds over a shaky connection ----------
  // Instant rounds are idempotent by key (lib/instant-idempotency.mjs). The same bet sent again
  // after a dropped connection goes out under the same key, so if the first one did land the
  // server answers with that round instead of playing a second. A changed bet gets a new key.
  roundKey(extra = '') {
    const fp = JSON.stringify([this.betZones.map(z => [z, this.zoneTotal(z)]), extra]);
    if (this.pendingRound?.fp !== fp) this.pendingRound = { fp, key: newKey() };
    return this.pendingRound.key;
  }
  roundDone() { this.pendingRound = null; }
  // The request failed: chips stay on the felt; a dropped connection offers 다시 시도 (same key).
  roundFailed(err, retry) {
    this.locked = false;
    this.root.classList.remove('is-playing');
    if (err?.code === 'NETWORK' && retry) this.toast(errorMessage(err), { action: '다시 시도', onAction: () => this.run(retry) });
    else { this.pendingRound = null; this.toast(errorMessage(err)); }
  }

  // Games that name their own moment (포카드, 광땡) call this directly; it shows only when the
  // win paid a max bet's worth at this table, unless `force` (a jackpot, or already checked).
  bigWin(amount, { title, subtitle, level = 0, multiple = 0, force = false } = {}) {
    if (!force && !namedWinCounts(amount, this.tier.min)) return Promise.resolve();
    return bigWin({ title, subtitle, amount, game: this.title, nickname: this.nickname, level: level || Math.max(1, bigWinLevel(amount, 0, this.tier.min)), multiple, min: this.tier.min, badges: this.winBadges(amount) });
  }

  // What else this win just did: the biggest single win this player has had at any game, or
  // the day's chips at a new high (lib/loss-tally.mjs). The server state already counts it.
  winBadges(amount) {
    const u = this.serverState?.user;
    if (!u) return [];
    const badges = [];
    const best = Math.max(0, ...Object.values(u.stats || {}).map(s => s?.biggestWin || 0));
    if (amount > 0 && amount >= best) badges.push('개인 최고 기록');
    const d = u.today, chips = (u.account?.available || 0) + (u.account?.locked || 0);
    if (d?.rounds > 1 && chips >= d.peak && chips > d.start) badges.push(`오늘 최고점 ${formatCH(chips)}`);
    return badges;
  }

  glow() {
    this.felt.classList.remove('is-glow');
    void this.felt.offsetWidth;
    this.felt.classList.add('is-glow');
  }

  // ---------- actions ----------
  setActions(list) {
    this.actionList = list;
    this.actions.replaceChildren(...list.map(a => {
      const b = el('button', `action${a.primary ? ' action--primary' : ''}${a.ghost ? ' action--ghost' : ''}`);
      b.type = 'button';
      if (a.pressed != null) b.setAttribute('aria-pressed', String(a.pressed));
      b.innerHTML = `<span>${a.label}</span>${a.key ? `<kbd>${a.key}</kbd>` : ''}`;
      // `anytime`: a way out (leaving a room) that works mid-animation, outside the busy lock.
      b.disabled = Boolean(a.disabled) || (this.busy && !a.anytime);
      if (a.anytime) { b.dataset.anytime = ''; b.addEventListener('click', () => a.onClick()); }
      else b.addEventListener('click', () => this.run(a.onClick));
      return b;
    }));
  }

  async run(fn) {
    if (this.busy || !fn) return;
    this.busy = true;
    this.actions.querySelectorAll('button:not([data-anytime])').forEach(b => { b.disabled = true; });
    try { await fn(); } finally { this.busy = false; this.refreshActions?.(); this.maybeIdle(); }
  }

  onKey(handler) {
    const fn = e => { if (!e.target.closest?.('input,textarea') && this.root.isConnected) handler(e); };
    window.addEventListener('keydown', fn);
    this.listeners.push(['keydown', fn]);
  }

  destroy() {
    this.listeners.forEach(([t, fn]) => (t === 'hot-timer' ? clearInterval(fn) : window.removeEventListener(t, fn))); this.listeners = []; this.hotTimer = null;
    this.seatRecap();
  }

  // Leaving says what this seat came to: "블랙잭 12판 · 3억원 잃었어요 · 오늘 -12억".
  seatRecap() {
    const now = this.serverState?.user?.today, then = this.seatDay;
    if (!now || this.recapped) return;
    this.recapped = true;
    const same = then?.day === now.day;
    const rounds = now.rounds - (same ? then.rounds : 0);
    if (!(rounds > 0)) return;
    const net = now.net - (same ? (then.net ?? then.won - then.lost) : 0);
    const day = now.net !== net ? ` · 오늘 ${now.net < 0 ? '-' : '+'}${formatCH(Math.abs(now.net))}` : '';
    setTimeout(() => noticeToast(`${this.title} ${rounds}판 · ${net ? moneyResult(net) : '본전'}${day}`, { duration: 4200 }), 350);
  }
}
