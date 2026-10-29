// 뽀찌: tipping the dealer (한서 2026-10-29 "딜러한테 뽀찌주는거 추가해줘"). A small toke box sits
// on the top rail by the dealer. Tap it, or flick a chip up at it, and the table's smallest chip
// leaves my stack, lands in the box, the dealer taps it in and says thanks. It only costs chips:
// odds, payouts and RP never change (lib/tips.mjs).
import { api, errorMessage } from './api.js';
import { createChip } from './chips.js';
import { animate, flyTo, sound, formatCH, el, wait, formatUnit } from './fx.js';
import { buzz } from './haptics.js';
import { voice } from './voice.js';

const THANKS = ['tip-1', 'tip-2', 'tip-3', 'tip-4'];
const SAID = { 'tip-1': 'Thank you, sir.', 'tip-2': 'Much appreciated.', 'tip-3': 'Thank you kindly.', 'tip-4': 'For the dealers. Thank you.' };
// After a win this many table minimums, the box glints for a while: a good moment to tip.
const GLINT_MIN = 10;

export class Toke {
  constructor(table) {
    this.t = table;
    this.amount = table.tier.chips[0];
    this.sending = false;
    const box = el('button', 'toke');
    box.type = 'button';
    box.setAttribute('aria-label', `딜러에게 팁 주기 · ${formatUnit(this.amount)}`);
    box.title = `딜러 팁 (뽀찌) · ${formatUnit(this.amount)}`;
    box.innerHTML = '<span class="toke-slot" aria-hidden="true"></span><span class="toke-word">TIPS</span>';
    box.addEventListener('click', () => this.give(null));
    table.root.append(box);
    this.box = box;
    // The box rides the felt's top rail wherever the layout puts the felt.
    this.place = () => {
      const f = table.felt;
      if (!f.isConnected) return;
      box.style.top = `${f.offsetTop - 2}px`;
      box.style.left = `${f.offsetLeft + f.offsetWidth / 2}px`;
    };
    this.place();
    if ('ResizeObserver' in window) {
      this.watch = new ResizeObserver(() => this.place());
      this.watch.observe(table.root);
      this.watch.observe(table.felt);
    }
    addEventListener('resize', this.place);
    table.listeners.push(['resize', this.place]);
  }

  rect() { return this.box.getBoundingClientRect(); }

  // Whether a chip flicked from (x, y) at velocity v is headed for the box: fast, upward, and
  // close to the line it was thrown along.
  aimedAt(x, y, v) {
    const speed = Math.hypot(v.x, v.y);
    if (speed < 0.9 || v.y > -0.5 || !this.box.offsetParent) return false;
    const r = this.rect();
    const cx = r.left + r.width / 2 - x, cy = r.top + r.height / 2 - y;
    const ahead = (cx * v.x + cy * v.y) / speed;
    if (ahead <= 0) return false;
    const off = Math.abs(cx * v.y - cy * v.x) / speed;
    return off < Math.max(36, ahead * 0.14);
  }

  hit(x, y) { const r = this.rect(); return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 8 && y <= r.bottom + 8; }

  // After a good win the box glints for a few seconds.
  noteWin(net) {
    if (!(net >= GLINT_MIN * this.t.tier.min)) return;
    this.box.classList.remove('is-glint');
    void this.box.offsetWidth;
    this.box.classList.add('is-glint');
    clearTimeout(this.glintTimer);
    this.glintTimer = setTimeout(() => this.box.classList.remove('is-glint'), 7000);
  }

  // from: where the chip starts (a tray chip's rect after a flick); by default my smallest stack.
  async give(from) {
    const t = this.t;
    if (this.sending) return;
    if (t.locked || t.busy) { t.hint('판이 끝나면 팁을 줄 수 있어요'); sound.tick(); return; }
    const free = t.available - t.total;
    if (free < this.amount) { t.toast('칩이 부족해서 팁을 줄 수 없어요'); buzz('reject'); return; }
    this.sending = true;
    this.box.classList.remove('is-glint');
    const start = from || t.tray.querySelector('.tray-slot button.chip')?.getBoundingClientRect();
    const req = api.tip(t.game, this.amount).then(res => ({ res }), err => ({ err }));
    // The chip comes off my stack at once, the way it leaves a real hand.
    t.setBalance(t.shownBalance - this.amount, { roll: false });
    await this.toss(start);
    const { res, err } = await req;
    if (err) {
      this.sending = false;
      t.toast(errorMessage(err));
      buzz('reject');
      t.syncBalance();
      return;
    }
    t.setServerState(res.state);
    t.syncBalance();
    await this.thank(res.tip);
    this.sending = false;
  }

  // The chip arcs from the stack onto the box and drops into the slot.
  async toss(start) {
    const box = this.rect();
    const chip = createChip(this.amount);
    chip.classList.add('chip-flyer', 'toke-flyer');
    const size = 34;
    const s = start || { left: innerWidth / 2 - size / 2, top: innerHeight - 140, width: size, height: size };
    Object.assign(chip.style, { left: `${s.left + s.width / 2 - size / 2}px`, top: `${s.top + s.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px` });
    chip.style.setProperty('--size', `${size}px`);
    document.body.append(chip);
    sound.chip();
    buzz('chip');
    await flyTo(chip, box, { duration: 520, lift: 90 });
    // It lands on the lid, the dealer taps it twice, and it slides into the slot.
    sound.chip();
    animate(this.box, [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: 220, fill: 'none' });
    // Keep the chip where it landed, then let it sink into the slot from there.
    const landed = getComputedStyle(chip).transform;
    chip.style.transform = landed === 'none' ? '' : landed;
    chip.getAnimations().forEach(a => a.cancel());
    await wait(140);
    this.tap();
    await wait(260);
    this.tap();
    const at = chip.style.transform || 'none';
    await animate(chip, [{ transform: at, opacity: 1 }, { transform: `${at === 'none' ? '' : at} translateY(6px) scale(.35)`, opacity: 0 }], { duration: 260, easing: 'ease-in' });
    chip.remove();
    this.box.classList.add('is-fed');
    setTimeout(() => this.box.classList.remove('is-fed'), 900);
  }

  // Two knuckle taps on the box, the dealer's thank-you on a real table.
  tap() {
    sound.tick();
    const r = this.rect();
    const knock = el('span', 'toke-knock');
    Object.assign(knock.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
    document.body.append(knock);
    setTimeout(() => knock.remove(), 500);
  }

  async thank(tip) {
    const line = THANKS[Math.floor(Math.random() * THANKS.length)];
    voice.say(line);
    buzz('push');
    // The thanks shows in the table's one toast spot, under the box: his words, then the tip.
    this.t.toast(`“${SAID[line]}”`);
    const node = this.t.root.querySelector('[data-toast]');
    node.append(el('small', 'toke-note', `딜러 팁 ${formatUnit(tip.amount)}${tip.count > 1 ? ` · 누적 ${tip.count}번` : ''}`));
  }

  destroy() {
    this.watch?.disconnect();
    clearTimeout(this.glintTimer);
  }
}
