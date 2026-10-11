// Shared table shell: header, felt, chip tray, bet zones, payouts and the balance readout.
import { animate, flyFrom, flyTo, sound, haptic, formatCH, formatFull, rollNumber, el, wait, ms } from './fx.js';
import { createChip, breakdown, TIERS } from './chips.js';

export class Table {
  constructor({ mount, game, title, tier, state, onLeave, feltClass = '' }) {
    this.tier = TIERS[tier] || TIERS.mid;
    this.game = game;
    this.available = state?.user?.account?.available ?? 0;
    this.shownBalance = this.available;
    this.bet = { zone: null, chips: [] };
    this.lastBet = null;
    this.selected = this.tier.chips[0];
    this.zones = new Map();
    this.locked = false;
    this.busy = false;
    this.listeners = [];

    const root = el('div', `table-screen table-screen--${game}`);
    root.innerHTML = `
      <header class="table-bar">
        <button class="table-back" type="button" aria-label="게임 목록으로 나가기"><span aria-hidden="true">←</span></button>
        <div class="table-name"><strong>${title}</strong><span>${this.tier.name} 테이블, ${formatCH(this.tier.min)} – ${formatCH(this.tier.max)} CH</span></div>
        <div class="table-balance"><span>보유 칩</span><strong data-balance>${formatFull(this.available)}</strong></div>
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
    this.renderTray();
    this.renderRack();
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
    return zone && this.zones.has(zone.dataset.zone) && !zone.disabled ? zone : null;
  }

  select(value) {
    this.selected = value;
    this.tray.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === value)));
  }

  tapChip(value, chip) {
    if (this.locked || this.busy) return;
    this.select(value);
    const target = this.bet.zone || (this.zones.size === 1 ? [...this.zones.keys()][0] : null);
    if (target) this.addChip(target, value, chip.getBoundingClientRect());
    else { sound.tick(); this.hint('베팅할 곳을 탭하세요'); this.zones.forEach(z => animate(z, [{ boxShadow: '0 0 0 0 rgba(255,215,120,0)' }, { boxShadow: '0 0 0 4px rgba(255,215,120,.55)' }, { boxShadow: '0 0 0 0 rgba(255,215,120,0)' }], { duration: 700, fill: 'none' })); }
  }

  // ---------- zones ----------
  addZone(node) {
    const id = node.dataset.zone;
    if (!node.querySelector('.bet-stack')) node.append(el('span', 'bet-stack'));
    this.zones.set(id, node);
    node.addEventListener('click', () => {
      if (this.locked || this.busy) return;
      this.addChip(id, this.selected, this.tray.querySelector(`[data-value="${this.selected}"]`)?.getBoundingClientRect());
    });
    return node;
  }

  stackOf(zoneId) { return this.zones.get(zoneId)?.querySelector('.bet-stack'); }
  get total() { return this.bet.chips.reduce((a, b) => a + b, 0); }

  async addChip(zoneId, value, fromRect) {
    if (this.locked || this.busy) return;
    if (this.bet.zone && this.bet.zone !== zoneId) { await this.moveBet(zoneId); }
    const next = this.total + value;
    if (next > this.tier.max) return this.reject(`이 테이블 최대 베팅은 ${formatCH(this.tier.max)}이에요`);
    if (next > this.available) return this.reject('칩이 부족해요');
    this.bet.zone = zoneId;
    this.bet.chips.push(value);
    const chip = this.pushChip(zoneId, value);
    sound.chip(); haptic(10);
    this.refreshBet();
    if (fromRect) await flyFrom(chip, fromRect, { duration: 380, lift: 60, scale: 1.1, spin: 40 });
  }

  pushChip(zoneId, value) {
    const stack = this.stackOf(zoneId);
    const chip = createChip(value);
    chip.style.setProperty('--i', stack.children.length);
    chip.style.setProperty('--jx', `${(Math.random() * 4 - 2).toFixed(1)}px`);
    stack.append(chip);
    this.zones.forEach(z => z.classList.toggle('has-bet', z.dataset.zone === zoneId));
    return chip;
  }

  async moveBet(zoneId) {
    const fromStack = this.stackOf(this.bet.zone);
    const rects = [...fromStack.children].map(c => c.getBoundingClientRect());
    fromStack.replaceChildren();
    this.bet.zone = zoneId;
    const chips = this.bet.chips.map(v => this.pushChip(zoneId, v));
    sound.chips(2);
    await Promise.all(chips.map((c, i) => flyFrom(c, rects[i], { duration: 320, delay: i * 25 })));
  }

  async clearBet({ animateBack = true } = {}) {
    if (!this.bet.zone) return;
    const stack = this.stackOf(this.bet.zone);
    const target = this.tray.getBoundingClientRect();
    if (animateBack) { sound.chips(2); await Promise.all([...stack.children].map((c, i) => flyTo(c, target, { duration: 320, delay: i * 20, fade: true }))); }
    stack.replaceChildren();
    this.bet = { zone: null, chips: [] };
    this.zones.forEach(z => z.classList.remove('has-bet'));
    this.refreshBet();
  }

  // ---------- fine bet adjustments ----------
  async undo() {
    if (this.locked || this.busy || !this.bet.chips.length) return;
    this.bet.chips.pop();
    const chip = this.stackOf(this.bet.zone)?.lastElementChild;
    sound.chip();
    if (chip) await flyTo(chip, this.tray.getBoundingClientRect(), { duration: 300, fade: true }).then(() => chip.remove());
    if (!this.bet.chips.length) { this.bet.zone = null; this.zones.forEach(z => z.classList.remove('has-bet')); }
    this.refreshBet();
  }

  async half() {
    if (this.locked || this.busy || !this.bet.chips.length) return;
    const step = Math.min(...this.tier.chips);
    const target = Math.max(step, Math.floor(this.total / 2 / step) * step);
    if (target >= this.total) return;
    const zone = this.bet.zone;
    await this.clearBet();
    this.bet.zone = zone;
    for (const v of breakdown(target, this.tier.chips, 20)) { this.bet.chips.push(v); this.pushChip(zone, v); }
    sound.chips(2);
    this.refreshBet();
  }

  async double() {
    if (this.locked || this.busy || !this.bet.chips.length) return;
    const room = Math.min(this.tier.max, this.available) - this.total;
    const values = breakdown(Math.min(this.total, room), this.tier.chips, 20).filter((v, i, all) => all.slice(0, i + 1).reduce((a, b) => a + b, 0) <= room);
    if (!values.length) return this.reject(this.total * 2 > this.tier.max ? `이 테이블 최대 베팅은 ${formatCH(this.tier.max)}이에요` : '칩이 부족해요');
    const tray = this.tray.getBoundingClientRect();
    for (const v of values) {
      this.bet.chips.push(v);
      const chip = this.pushChip(this.bet.zone, v);
      sound.chip();
      flyFrom(chip, tray, { duration: 320, lift: 40 });
      await wait(60);
    }
    this.refreshBet();
  }

  async rebet() {
    if (!this.lastBet) return;
    await this.clearBet({ animateBack: false });
    for (const v of this.lastBet.chips) {
      if (this.total + v > Math.min(this.tier.max, this.available)) break;
      await this.addChip(this.lastBet.zone, v, this.tray.getBoundingClientRect());
    }
  }

  // Extra chips pushed out for a double or split.
  async addFromTray(zoneId, amount) {
    const values = breakdown(amount, this.tier.chips, 6);
    const tray = this.tray.getBoundingClientRect();
    for (const v of values) {
      const chip = this.pushChip(zoneId, v);
      sound.chip();
      await flyFrom(chip, tray, { duration: 300, lift: 50 });
    }
    this.bet.chips.push(amount);
    this.refreshBet();
  }

  refreshBet() {
    this.betEl.textContent = formatCH(this.total);
    const short = this.total > 0 && this.total < this.tier.min;
    this.hint(short ? `최소 ${formatCH(this.tier.min)}` : '');
    if (!this.locked) this.setBalance(this.available - this.total, { roll: false });
    const empty = !this.bet.chips.length;
    this.tools.forEach(b => { b.disabled = empty; });
    this.onBetChange?.();
  }

  get betReady() { return this.total >= this.tier.min && this.total <= this.tier.max && this.bet.zone; }

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
    this.lastBet = { zone: this.bet.zone, chips: [...this.bet.chips] };
  }

  // Resolve the bet on the felt: winnings slide in from the rack, losses get raked away.
  async settle(net, { label, kind } = {}) {
    const zoneId = this.bet.zone;
    const stack = this.stackOf(zoneId);
    const stake = this.total;
    if (net > 0) {
      const pay = breakdown(net, this.tier.chips, 12);
      const payStack = el('span', 'bet-stack bet-stack--payout');
      stack.after(payStack);
      const rack = this.rack.getBoundingClientRect();
      sound.chips(Math.min(pay.length, 6));
      await Promise.all(pay.map((v, i) => {
        const c = createChip(v); c.style.setProperty('--i', i); payStack.append(c);
        return flyFrom(c, rack, { duration: 460, delay: i * 70, lift: 40 });
      }));
    }
    if (label) this.banner(label, kind || (net > 0 ? 'win' : net < 0 ? 'lose' : 'push'));
    if (net > 0) { sound.win(); haptic([20, 60, 30]); this.glow(); }
    else if (net < 0) { sound.lose(); haptic(30); }
    else sound.push();
    await wait(net > 0 ? 900 : 650);
    const chips = [...(stack?.parentElement?.querySelectorAll('.bet-stack .chip') || [])];
    const target = net < 0 ? this.rack.getBoundingClientRect() : this.balanceEl.getBoundingClientRect();
    if (chips.length) sound.chips(3);
    await Promise.all(chips.map((c, i) => flyTo(c, target, { duration: 420, delay: i * 30, lift: net < 0 ? 0 : 50, fade: true })));
    this.resetRound();
    void stake;
  }

  // Clears the felt and unlocks betting; games that move their own chips call this directly.
  resetRound() {
    this.zones.forEach(z => { z.querySelectorAll('.bet-stack--payout').forEach(s => s.remove()); z.classList.remove('has-bet'); });
    if (this.bet.zone) this.stackOf(this.bet.zone)?.replaceChildren();
    this.bet = { zone: null, chips: [] };
    this.betEl.textContent = '0';
    this.locked = false;
    this.root.classList.remove('is-playing');
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
      await rollNumber(this.balanceEl, from, value);
      setTimeout(() => this.balanceEl.parentElement.classList.remove('is-up', 'is-down'), ms(600));
    } else this.balanceEl.textContent = formatFull(value);
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
