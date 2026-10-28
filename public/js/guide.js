// Table help. The first time someone sits at a game they get one short line at a time, right
// when it matters during their first hand (FirstTips). The full step-by-step coach and the
// rules sheet live behind "?" for anyone who wants more.
import { el } from './fx.js';
import { GUIDES } from './guides.js';
import { settings } from './settings.js';

const seenKey = id => `vegas:guide:${id}`;
const seen = id => { try { return localStorage.getItem(seenKey(id)) === '1'; } catch { return true; } };
const markSeen = id => { try { localStorage.setItem(seenKey(id), '1'); } catch {} };

// Forget which guides were seen, so each game's coach starts again on the next visit.
export function resetGuides() {
  try { Object.keys(GUIDES).forEach(id => localStorage.removeItem(seenKey(GUIDES[id].id || id))); } catch {}
}

class Coach {
  constructor(table, def) {
    this.table = table;
    this.def = def;
    this.root = null;
    this.index = 0;
    this.frame = 0;
  }

  get active() { return Boolean(this.root); }

  start(at = 0) {
    this.stop({ remember: false });
    this.root = el('div', 'coach');
    this.root.innerHTML = `<div class="coach-ring"></div><div class="coach-bubble" role="group" aria-label="${this.def.title} 가이드"><div data-copy aria-live="polite"></div><div class="coach-foot"><span data-count></span><button type="button" data-skip>그만 보기</button><button type="button" data-prev>이전</button><button type="button" class="is-primary" data-next>다음</button></div></div>`;
    this.ring = this.root.querySelector('.coach-ring');
    this.bubble = this.root.querySelector('.coach-bubble');
    this.root.querySelector('[data-skip]').addEventListener('click', () => this.stop());
    this.root.querySelector('[data-prev]').addEventListener('click', () => this.go(this.index - 1));
    this.root.querySelector('[data-next]').addEventListener('click', () => this.go(this.index + 1));
    this.table.root.append(this.root);
    this.go(at);
    const tick = () => { if (!this.root) return; this.follow(); this.check(); this.frame = requestAnimationFrame(tick); };
    this.frame = requestAnimationFrame(tick);
  }

  stop({ remember = true } = {}) {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.advanceTimer);
    this.root?.remove();
    this.root = null;
    if (remember) markSeen(this.def.id);
  }

  step() { return this.def.steps[this.index]; }

  go(i) {
    if (i >= this.def.steps.length) { this.stop(); this.table.toast?.('언제든 ? 버튼으로 다시 볼 수 있어요'); return; }
    this.index = Math.max(0, i);
    this.state = {};
    this.done = false;
    clearTimeout(this.advanceTimer);
    const s = this.step();
    s.enter?.(this.table, this.state);
    const body = (Array.isArray(s.body) ? s.body : [s.body]).map(p => `<p>${p}</p>`).join('');
    this.root.querySelector('[data-copy]').innerHTML = `<h3>${s.title}</h3>${body}${s.eg ? `<p class="coach-eg">${s.eg}</p>` : ''}${s.do ? `<div class="coach-do" data-do>${s.do}</div>` : ''}`;
    this.root.querySelector('[data-count]').textContent = `${this.index + 1} / ${this.def.steps.length}`;
    this.root.querySelector('[data-prev]').disabled = this.index === 0;
    const next = this.root.querySelector('[data-next]');
    next.textContent = this.index === this.def.steps.length - 1 ? '끝' : s.until ? '건너뛰기' : '다음';
    next.focus({ preventScroll: true });
    this.follow(true);
  }

  // Hands-on steps finish themselves once the table shows the player did the thing.
  check() {
    const s = this.step();
    if (!s?.until || this.done) return;
    let ok = false;
    try { ok = s.until(this.table, this.state); } catch {}
    if (!ok) return;
    this.done = true;
    const box = this.root.querySelector('[data-do]');
    if (box) { box.classList.add('is-done'); box.textContent = s.doneText || '잘했어요!'; }
    this.root.querySelector('[data-next]').textContent = '다음';
    this.advanceTimer = setTimeout(() => this.root && this.go(this.index + 1), 1100);
  }

  target() {
    const s = this.step();
    if (!s.target) return null;
    const node = typeof s.target === 'function' ? s.target(this.table.root, this.table) : this.table.root.querySelector(s.target);
    if (!node || !node.isConnected) return null;
    const r = node.getBoundingClientRect();
    return r.width && r.height ? r : null;
  }

  follow(force = false) {
    const r = this.target();
    const vw = innerWidth, vh = innerHeight, pad = 6;
    if (!r) {
      this.ring.classList.add('is-none');
      Object.assign(this.ring.style, { left: `${vw / 2}px`, top: `${vh / 2}px` });
    } else {
      this.ring.classList.remove('is-none');
      const box = { left: Math.max(4, r.left - pad), top: Math.max(4, r.top - pad), width: Math.min(vw - 8, r.width + pad * 2), height: Math.min(vh - 8, r.height + pad * 2) };
      const key = `${box.left|0},${box.top|0},${box.width|0},${box.height|0}`;
      if (key !== this.lastKey || force) {
        this.lastKey = key;
        Object.assign(this.ring.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
      }
    }
    // Bubble goes on whichever side of the highlight has more room.
    const bh = this.bubble.offsetHeight;
    let top;
    if (!r) top = (vh - bh) / 2;
    else {
      const below = vh - r.bottom, above = r.top;
      top = below >= above ? r.bottom + 16 : r.top - 16 - bh;
      if (top + bh > vh - 8 || top < 8) top = below >= above ? vh - bh - 12 : 12;
    }
    this.bubble.style.top = `${Math.round(Math.max(8, Math.min(vh - bh - 8, top)))}px`;
  }
}

// One line near the part of the table that matters right now, only during the first hand.
// Each tip shows while its `when` holds and never comes back once it has passed, so a player
// who already knows the game just plays and the lines fall away by themselves.
class FirstTips {
  constructor(table, def) {
    this.table = table;
    this.def = def;
    this.shown = new Set();
    this.current = null;
    this.played = false;
    this.root = null;
  }

  get active() { return Boolean(this.root); }

  start() {
    this.root = el('div', 'tip');
    this.root.innerHTML = '<span class="tip-ring"></span><button type="button" class="tip-line" aria-live="polite"></button>';
    this.ring = this.root.firstChild;
    this.line = this.root.lastChild;
    // Tapping the line puts it away; the table keeps going.
    this.line.addEventListener('click', () => { if (this.current) this.shown.add(this.current); this.show(null); });
    this.table.root.append(this.root);
    this.timer = setInterval(() => this.check(), 250);
    this.check();
  }

  stop({ remember = true } = {}) {
    clearInterval(this.timer);
    clearTimeout(this.byeTimer);
    this.root?.remove();
    this.root = null;
    if (remember) markSeen(this.def.id);
  }

  check() {
    const t = this.table;
    if (!this.root || !t.root.isConnected) return;
    // Once the coach or a sheet is open, the player is reading help already.
    if (t.guide?.active || t.root.querySelector('.sheet.is-open')) { this.show(null); return; }
    if (this.bye) return this.follow();
    const done = this.def.tipsDone || (tt => this.played && !tt.locked);
    if (t.locked) this.played = true;
    if (done(t, this)) return this.finish();
    const ok = tip => { try { return tip.when(t); } catch { return false; } };
    const tip = this.def.tips.find(x => !this.shown.has(x) && ok(x)) || null;
    // A tip that stops applying has done its job; move on and do not repeat it.
    if (this.current && this.current !== tip && !ok(this.current)) this.shown.add(this.current);
    if (tip !== this.current) { this.show(tip); this.since = Date.now(); }
    // Something to read, not to do, steps aside after a while.
    else if (tip && !tip.stay && Date.now() - this.since > 7000) { this.shown.add(tip); this.show(null); }
    this.follow();
  }

  finish() {
    this.bye = { target: '.table-help', text: '규칙과 따라 하기는 ? 버튼에 있어요' };
    markSeen(this.def.id);
    this.show(this.bye);
    this.byeTimer = setTimeout(() => this.stop(), 4200);
  }

  show(tip) {
    this.current = tip === this.bye ? this.current : tip;
    this.root.classList.toggle('is-on', Boolean(tip));
    if (!tip) return;
    this.line.textContent = tip.text;
    this.line.setAttribute('aria-label', `${tip.text} (탭해서 닫기)`);
    this.line.classList.remove('is-in');
    void this.line.offsetWidth;
    this.line.classList.add('is-in');
    this.tip = tip;
  }

  follow() {
    if (!this.root.classList.contains('is-on')) return;
    const tip = this.tip;
    const node = tip.target ? this.table.root.querySelector(tip.target) : null;
    const r = node?.isConnected ? node.getBoundingClientRect() : null;
    const vw = innerWidth, vh = innerHeight;
    const lh = this.line.offsetHeight || 40;
    const on = r && r.width && r.height && r.bottom > 0 && r.top < vh;
    this.ring.classList.toggle('is-none', !on);
    const lw = this.line.offsetWidth || 240;
    const cx = on ? (Math.max(0, r.left) + Math.min(vw, r.right)) / 2 : vw / 2;
    this.line.style.left = `${Math.round(Math.max(12, Math.min(vw - lw - 12, cx - lw / 2)))}px`;
    let top;
    if (!on) top = vh * 0.38;
    else {
      const pad = 4;
      Object.assign(this.ring.style, { left: `${Math.max(2, r.left - pad)}px`, top: `${Math.max(2, r.top - pad)}px`, width: `${Math.min(vw - 4, r.width + pad * 2)}px`, height: `${Math.min(vh - 4, r.height + pad * 2)}px` });
      // Above the spot when there is room (thumbs cover what is below), otherwise below.
      top = r.top - lh - 12 >= 56 ? r.top - lh - 12 : r.bottom + 12;
      if (top + lh > vh - 8) top = Math.max(56, r.top + 8);
    }
    this.line.style.top = `${Math.round(Math.max(8, Math.min(vh - lh - 8, top)))}px`;
  }
}

function rulesSheet(table, def, coach) {
  const sheet = el('section', 'sheet');
  sheet.setAttribute('aria-label', `${def.title} 규칙`);
  sheet.inert = true;
  sheet.innerHTML = `<div class="sheet-head"><h2>${def.title} 하는 법</h2><button type="button" class="sheet-close" data-close>닫기</button></div>
    <button type="button" class="action action--primary" data-tour>테이블에서 따라 하며 배우기</button>
    <div class="rules">${def.rules}</div>`;
  const open = value => {
    if (value) table.root.querySelectorAll('.sheet.is-open').forEach(s => { if (s !== sheet) s.querySelector('[data-close]')?.click(); });
    sheet.classList.toggle('is-open', value);
    sheet.inert = !value;
    if (value) sheet.querySelector('[data-tour]').focus({ preventScroll: true });
  };
  sheet.querySelector('[data-close]').addEventListener('click', () => { open(false); table.root.querySelector('.table-help')?.focus({ preventScroll: true }); });
  sheet.querySelector('[data-tour]').addEventListener('click', () => { open(false); if (table.firstTips?.active) table.firstTips.stop(); coach.start(); });
  table.root.append(sheet);
  return { open, get isOpen() { return sheet.classList.contains('is-open'); } };
}

// Adds the "?" button, the rules sheet and the coach to a mounted table. The coach starts by
// itself the first time someone sits at this game.
export function attachGuide(table, gameId) {
  const def = GUIDES[gameId];
  if (!def || !table?.root) return null;
  const coach = new Coach(table, def);
  const sheet = rulesSheet(table, def, coach);
  const help = el('button', 'table-help table-icon', '?');
  help.type = 'button';
  help.setAttribute('aria-label', `${def.title} 하는 법과 규칙`);
  help.addEventListener('click', () => { if (coach.active) coach.stop(); sheet.open(!sheet.isOpen); });
  (table.root.querySelector('.table-tools') || table.root.querySelector('.table-bar'))?.append(help);

  // Escape closes the coach or the sheet first, before it can leave the table.
  const onKey = e => {
    if (e.key !== 'Escape') return;
    if (coach.active) { coach.stop(); e.stopImmediatePropagation(); }
    else if (table.firstTips?.root?.classList.contains('is-on')) { table.firstTips.line.click(); e.stopImmediatePropagation(); }
    else if (sheet.isOpen) { sheet.open(false); e.stopImmediatePropagation(); }
  };
  window.addEventListener('keydown', onKey, true);
  const destroy = table.destroy.bind(table);
  table.destroy = () => { if (coach.active) coach.stop({ remember: false }); if (table.firstTips?.active) table.firstTips.stop({ remember: false }); window.removeEventListener('keydown', onKey, true); return destroy(); };
  table.guide = coach;
  // First visit: short lines during the first hand instead of a stack of cards before it.
  if (settings.get('guides') && !seen(def.id) && def.tips?.length) {
    const tips = new FirstTips(table, def);
    table.firstTips = tips;
    setTimeout(() => { if (table.root.isConnected && !coach.active && !tips.active) tips.start(); }, 600);
  }
  return coach;
}
