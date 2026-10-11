// Shared table shell: header, felt, chip tray, bet zones, payouts and the balance readout.
import { animate, flyFrom, flyTo, flyOut, sound, haptic, formatCH, formatFull, rollNumber, el, wait, ms } from './fx.js';
import { createChip, breakdown, TIERS } from './chips.js';
import { bigWin, isBigWin, BIG_WIN_MULTIPLE } from './bigwin.js';

// Narrow phones show the balance as 12억 5천만 so the top bar keeps room for its buttons.
const balanceText = value => (innerWidth < 520 ? formatCH : formatFull)(value);

// Per-device memory of the chip last picked and the last bet placed, per game and table.
const memoryKey = (game, tier, what) => `vegas:${what}:${game}:${tier}`;
function recall(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

export class Table {
  // multi: separate bets per zone. zoneMin: every zone must meet the table minimum (blackjack
  // boxes) rather than the total (chips spread over a roulette layout).
  constructor({ mount, game, title, tier, state, onLeave, feltClass = '', multi = false, zoneMin = true, zoneWord = '박스당' }) {
    this.tier = TIERS[tier] || TIERS.mid;
    this.game = game;
    this.available = state?.user?.account?.available ?? 0;
    this.nickname = state?.user?.nickname ?? '';
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
        <button class="table-back" type="button" aria-label="게임 목록으로 나가기"><span aria-hidden="true">←</span></button>
        <div class="table-name"><strong>${title}</strong><span>${this.tier.name} · ${formatCH(this.tier.min)}–${formatCH(this.tier.max)}원</span></div>
        <div class="table-balance"><span>보유 칩</span><strong data-balance>${balanceText(this.available)}</strong></div>
        <div class="table-tools">
          <button class="sound-toggle table-icon" type="button" data-sound aria-label="소리 끄기" aria-pressed="true"><span aria-hidden="true">♪</span></button>
        </div>
      </header>
      <div class="felt ${feltClass}" data-felt>
        <div class="felt-print" aria-hidden="true"></div>
        <div class="dealer-rack" data-rack aria-hidden="true"></div>
        <div class="felt-body" data-body></div>
        <div class="banner" data-banner aria-live="assertive"></div>
        <div class="toast" data-toast role="status" aria-live="polite"></div>
      </div>
      <div class="table-controls">
        <div class="bet-readout"><span>베팅</span><strong data-bet>0</strong><small data-hint></small></div>
        <div class="bet-tools" role="group" aria-label="베팅 조절">
          <button class="bet-tool" type="button" data-tool="undo" aria-label="마지막 칩 되돌리기">되돌리기</button>
          <button class="bet-tool" type="button" data-tool="half" aria-label="베팅 절반으로">½</button>
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
    this.betEl = root.querySelector('[data-bet]');
    this.hintEl = root.querySelector('[data-hint]');
    root.querySelector('.table-back').addEventListener('click', () => onLeave?.());
    this.tools = root.querySelectorAll('[data-tool]');
    root.querySelector('[data-tool="undo"]').addEventListener('click', () => this.undo());
    root.querySelector('[data-tool="half"]').addEventListener('click', () => this.half());
    root.querySelector('[data-tool="double"]').addEventListener('click', () => this.double());
    root.querySelector('[data-tool="max"]').addEventListener('click', () => this.max());
    this.renderTray();
    this.renderRack();
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

  renderTray() {
    this.tray.replaceChildren(...this.tier.chips.map(value => {
      const chip = createChip(value, 'button');
      chip.type = 'button';
      chip.setAttribute('aria-label', `${formatCH(value)} 칩`);
      chip.setAttribute('aria-pressed', String(value === this.selected));
      this.bindChip(chip, value);
      return chip;
    }));
  }

  bindChip(chip, value) {
    let start = null, ghost = null;
    chip.addEventListener('pointerdown', e => {
      if (this.locked || this.busy) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
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
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        const zone = this.zoneAt(e.clientX, e.clientY);
        this.zones.forEach(z => z.classList.toggle('is-hover', z === zone));
      }
    });
    const end = e => {
      if (!start) return;
      const dragged = Boolean(ghost);
      if (ghost) {
        const zone = this.zoneAt(e.clientX, e.clientY);
        const rect = ghost.getBoundingClientRect();
        ghost.remove(); ghost = null;
        this.zones.forEach(z => z.classList.remove('is-hover'));
        if (zone && e.type === 'pointerup') this.addChip(zone.dataset.zone, value, rect);
      }
      start = null;
      if (!dragged && e.type === 'pointerup') this.tapChip(value, chip);
    };
    chip.addEventListener('pointerup', end);
    chip.addEventListener('pointercancel', end);
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.tapChip(value, chip); } });
  }

  zoneAt(x, y) {
    const hit = document.elementsFromPoint(x, y).find(n => n.closest?.('[data-zone]'));
    const zone = hit?.closest('[data-zone]');
    return zone && this.zones.has(zone.dataset.zone) && !this.passive.has(zone.dataset.zone) && !zone.disabled ? zone : null;
  }

  select(value) {
    this.selected = value;
    remember(memoryKey(this.game, this.tier.slug, 'chip'), value);
    this.tray.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === value)));
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

  async addChip(zoneId, value, fromRect) {
    if (this.locked || this.busy) return;
    if (!this.multi) { const held = this.bet.zone; if (held && held !== zoneId) await this.moveBet(held, zoneId); }
    this.setFocus(zoneId);
    if (this.zoneTotal(zoneId) + value > this.tier.max) return this.reject(`${this.multi ? this.zoneWord : '이 테이블'} 최대 베팅은 ${formatCH(this.tier.max)}이에요`);
    if (this.total + value > this.available) return this.reject('칩이 부족해요');
    this.record(zoneId, value);
    const chip = this.pushChip(zoneId, value);
    sound.chip(); haptic(10);
    this.refreshBet();
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
  async undo() {
    if (this.locked || this.busy || !this.history.length) return;
    const zoneId = this.history.pop();
    this.chipsOf(zoneId).pop();
    const chip = this.stackOf(zoneId)?.lastElementChild;
    sound.chip();
    if (chip) await flyTo(chip, this.tray.getBoundingClientRect(), { duration: 300, fade: true }).then(() => chip.remove());
    if (!this.chipsOf(zoneId).length) this.emptyZone(zoneId);
    this.refreshBet();
  }

  async half() {
    if (this.locked || this.busy || !this.total) return;
    const step = Math.min(...this.tier.chips);
    let changed = false;
    for (const zoneId of this.betZones) {
      const now = this.zoneTotal(zoneId);
      // Halving never drops a bet under the table minimum.
      const target = Math.max(this.sides.has(zoneId) || !this.zoneMin ? step : Math.ceil(this.tier.min / step) * step, Math.floor(now / 2 / step) * step);
      if (target < now) { this.restack(zoneId, target); changed = true; }
    }
    if (!changed) return;
    sound.chips(2);
    this.refreshBet();
  }

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
    sound.chips(3); haptic(12);
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
    sound.chips(2);
    await Promise.all([...stack.children].map((c, i) => flyTo(c, this.rack.getBoundingClientRect(), { duration: 420, delay: i * 30, fade: true })));
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
    this.tools.forEach(b => { b.disabled = b.dataset.tool === 'max' ? !this.maxZone : empty; });
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
  idleActions(label, go) {
    const again = !this.total && this.lastBet;
    if (again) return [
      { label: '다시 베팅', ghost: true, onClick: () => this.rebet() },
      { label: `같은 베팅으로 ${label}`, key: '↵', primary: true, onClick: async () => { await this.rebet(); if (this.betReady) await go(); } }
    ];
    return [
      { label: '지우기', ghost: true, disabled: !this.total, onClick: () => this.clearBet() },
      { label, key: '↵', primary: true, disabled: !this.betReady, onClick: go }
    ];
  }

  // Enter runs whatever the primary idle button does right now.
  enterAction() { return this.actionList?.find(a => a.key === '↵' && !a.disabled) || null; }

  reject(message) {
    sound.tick(); haptic([10, 40, 10]);
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
  // `big` names a moment worth stopping the table for ({ title, subtitle }); any win of five
  // times the stake or more gets one anyway.
  async settle(net, { label, kind, zones, big } = {}) {
    const staked = this.total;
    const held = [...this.bets.keys()].filter(z => this.chipsOf(z).length);
    const nets = zones || new Map([[held[0], net]]);
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
        pays.push(flyFrom(c, rack, { duration: 460, delay: i * 70, lift: 40 }));
      });
    });
    if (pays.length) { sound.chips(Math.min(pays.length, 6)); await Promise.all(pays); }
    if (label) this.banner(label, kind || (net > 0 ? 'win' : net < 0 ? 'lose' : 'push'));
    if (net > 0) { sound.win(); haptic([20, 60, 30]); this.glow(); }
    else if (net < 0) { sound.lose(); haptic(30); }
    else sound.push();
    if (net > 0 && (big || isBigWin(net, staked))) await this.bigWin(net, big || { title: staked > 0 && net >= staked * BIG_WIN_MULTIPLE ? `${Math.floor(net / staked)}×` : '대박' });
    await wait(net > 0 ? 900 : 650);
    const moves = [];
    const balance = this.balanceEl.getBoundingClientRect();
    new Set([...held, ...nets.keys()]).forEach(zoneId => {
      const node = this.zones.get(zoneId);
      if (!node) return;
      const lost = (nets.get(zoneId) ?? 0) < 0;
      node.querySelectorAll('.bet-stack .chip').forEach(c => moves.push(lost
        ? flyTo(c, rack, { duration: 420, delay: moves.length * 30, fade: true })
        : flyOut(c, balance, { duration: 520, delay: moves.length * 40, lift: 60, onLand: () => this.catchChips() })));
    });
    if (moves.length) sound.chips(3);
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
  }

  setServerState(state) {
    if (state?.user?.account) this.available = state.user.account.available;
  }

  async setBalance(value, { roll = true } = {}) {
    const from = this.shownBalance;
    this.shownBalance = value;
    if (roll) {
      this.balanceEl.parentElement.classList.toggle('is-up', value > from);
      this.balanceEl.parentElement.classList.toggle('is-down', value < from);
      await rollNumber(this.balanceEl, from, value, { format: balanceText });
      setTimeout(() => this.balanceEl.parentElement.classList.remove('is-up', 'is-down'), ms(600));
    } else this.balanceEl.textContent = balanceText(value);
    this.balanceEl.parentElement.title = `${formatFull(value)}원`;
  }

  // The wallet answers each chip that lands in it: a small bounce, and the count starts rolling up.
  catchChips() {
    const box = this.balanceEl.parentElement;
    animate(box, [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    if (!this.catching) { this.catching = true; this.syncBalance().finally(() => { this.catching = false; }); }
  }

  syncBalance() { return this.setBalance(this.available - (this.locked ? 0 : this.total)); }

  // ---------- feedback ----------
  banner(text, kind = 'win') {
    const node = this.root.querySelector('[data-banner]');
    node.className = `banner banner--${kind} is-shown`;
    node.textContent = text;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => node.classList.remove('is-shown'), ms(1800));
  }

  toast(text) {
    const node = this.root.querySelector('[data-toast]');
    node.textContent = text;
    node.classList.add('is-shown');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => node.classList.remove('is-shown'), 2600);
  }

  bigWin(amount, { title, subtitle } = {}) {
    return bigWin({ title, subtitle, amount, game: this.title, nickname: this.nickname });
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
      b.disabled = Boolean(a.disabled) || this.busy;
      b.addEventListener('click', () => this.run(a.onClick));
      return b;
    }));
  }

  async run(fn) {
    if (this.busy || !fn) return;
    this.busy = true;
    this.actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await fn(); } finally { this.busy = false; this.refreshActions?.(); }
  }

  onKey(handler) {
    const fn = e => { if (!e.target.closest?.('input,textarea') && this.root.isConnected) handler(e); };
    window.addEventListener('keydown', fn);
    this.listeners.push(['keydown', fn]);
  }

  destroy() { this.listeners.forEach(([t, fn]) => window.removeEventListener(t, fn)); this.listeners = []; }
}
