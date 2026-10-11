// AI regulars for the house tables: they sit on the rail, put their own chips on the layout
// while you bet, and get paid or raked with you. Purely cosmetic, never sent to the server,
// and kept out of the Table's own zones, totals and rebet memory.
import { el, flyFrom, flyTo, wait, ms, sound, formatCH, rollNumber, reducedMotion } from './fx.js';
import { createChip, breakdown } from './chips.js';

const NAMES = ['NOVA', 'REX', 'LUNA', 'ACE', 'MIRA', 'JUNO', 'KAI', 'VEGA', 'ORION', 'SOL', 'ZARA', 'NIKO'];
const WIN = ['나이스!', '좋아요!', '역시 감이 왔어', '오늘 되는 날이네'];
const LOSE = ['아깝다', '다음 판엔…', '흠', '딜러님 살살요'];
const pick = list => list[Math.floor(Math.random() * list.length)];
const between = (lo, hi) => lo + Math.random() * (hi - lo);

// Up to `cap` chips from the table's own denominations, adding up to about `amount`.
export function chipsFor(amount, denoms, cap = 6) {
  return breakdown(Math.max(amount, Math.min(...denoms)), denoms, cap);
}

// Mounts the rail on a Table. `plan(npc, table)` returns this round's bets as
// [{ zone, amount, line? }]; `outcome(zone, stake)` (given to settle) returns that bet's net.
export function seatCrowd(t, { plan, count = innerWidth < 420 ? 3 : 4 }) {
  const rail = el('div', 'crowd');
  rail.setAttribute('aria-label', '함께 앉은 AI 플레이어');
  t.body.append(rail);
  t.root.classList.add('has-crowd');
  const names = [...NAMES].sort(() => Math.random() - 0.5);
  const seats = Array.from({ length: count }, (_, i) => {
    const npc = { name: names[i], seat: i, chips: 0, bets: [], timer: 0, placing: null, bold: Math.random() };
    npc.node = el('div', 'crowd-seat');
    npc.node.style.setProperty('--seat', i);
    npc.node.innerHTML = `<span class="crowd-avatar" aria-hidden="true">${npc.name[0]}</span><span class="crowd-meta"><b>${npc.name}</b><span data-chips></span></span><span class="crowd-bubble" role="status"></span>`;
    npc.chipsEl = npc.node.querySelector('[data-chips]');
    npc.avatar = npc.node.querySelector('.crowd-avatar');
    npc.bubble = npc.node.querySelector('.crowd-bubble');
    buyIn(npc);
    rail.append(npc.node);
    return npc;
  });
  let open = false;

  function buyIn(npc) {
    npc.chips = Math.round(t.tier.min * between(18, 90) / t.tier.chips[0]) * t.tier.chips[0];
    npc.chipsEl.textContent = formatCH(npc.chips);
  }

  function say(npc, text) {
    if (!text) return;
    npc.bubble.textContent = text;
    npc.bubble.classList.add('is-shown');
    clearTimeout(npc.bubbleTimer);
    npc.bubbleTimer = setTimeout(() => npc.bubble.classList.remove('is-shown'), Math.max(ms(2200), 1400));
  }

  function setChips(npc, value) {
    const from = npc.chips;
    npc.chips = value;
    rollNumber(npc.chipsEl, from, value, { duration: 500, format: formatCH });
  }

  // A stack of AI chips sits in its own corner of the spot, apart from your chips.
  function stackOn(zone, npc) {
    const node = t.zones.get(zone);
    if (!node) return null;
    let stack = node.querySelector(`.npc-stack[data-seat="${npc.seat}"]`);
    if (!stack) { stack = el('span', 'npc-stack'); stack.dataset.seat = npc.seat; node.append(stack); }
    return stack;
  }

  async function place(npc, quick) {
    const bets = plan(npc, t).filter(b => t.zones.has(b.zone) && b.amount > 0);
    let spent = bets.reduce((a, b) => a + b.amount, 0);
    // Short of chips: back the first spot only, or sit this one out.
    if (spent > npc.chips) { bets.splice(1); spent = bets[0]?.amount || 0; if (spent > npc.chips) return; }
    if (!quick) say(npc, bets.find(b => b.line)?.line);
    setChips(npc, npc.chips - spent);
    const from = npc.avatar.getBoundingClientRect();
    for (const b of bets) {
      const stack = stackOn(b.zone, npc);
      if (!stack) continue;
      npc.bets.push({ zone: b.zone, stake: b.amount, stack });
      for (const v of chipsFor(b.amount, t.tier.chips, 5)) {
        const chip = createChip(v);
        chip.style.setProperty('--i', stack.children.length);
        stack.append(chip);
        sound.chip();
        flyFrom(chip, from, { duration: 380, lift: 60, scale: 1.1, spin: 40 });
        await wait(quick ? 40 : 110);
      }
      if (!quick) await wait(between(120, 360));
    }
  }

  return {
    seats,
    // Open betting for the next round: each regular drops chips in at their own moment.
    open() {
      open = true;
      seats.forEach(npc => {
        npc.bets = [];
        clearTimeout(npc.timer);
        npc.timer = setTimeout(() => { if (open && rail.isConnected) npc.placing = place(npc, false); }, ms(between(700, 4200)) + 40 * npc.seat);
      });
    },
    // The round is starting: anyone still thinking puts their chips down now.
    async close() {
      open = false;
      seats.forEach(npc => {
        clearTimeout(npc.timer);
        if (!npc.placing && !npc.bets.length) npc.placing = place(npc, true);
      });
      await Promise.all(seats.map(npc => npc.placing));
      seats.forEach(npc => { npc.placing = null; });
    },
    // Pay or rake every AI bet exactly like yours: winnings out of the rack, then the spot cleared.
    async settle(outcome) {
      const rack = t.rack.getBoundingClientRect();
      const pays = [];
      const results = seats.map(npc => npc.bets.map(b => ({ ...b, net: outcome(b.zone, b.stake) })));
      results.flat().forEach(b => {
        if (!(b.net > 0)) return;
        const pay = el('span', 'npc-stack npc-stack--payout');
        pay.dataset.seat = b.stack.dataset.seat;
        b.stack.after(pay);
        b.pay = pay;
        chipsFor(b.net, t.tier.chips, 6).forEach((v, i) => {
          const c = createChip(v); c.style.setProperty('--i', i); pay.append(c);
          pays.push(flyFrom(c, rack, { duration: 460, delay: i * 70 + pays.length * 20, lift: 40 }));
        });
      });
      await Promise.all(pays);
      await wait(pays.length ? 900 : 650);
      const moves = [];
      results.forEach((bets, i) => {
        const npc = seats[i];
        const seat = npc.avatar.getBoundingClientRect();
        bets.forEach(b => {
          const chips = [...b.stack.children, ...(b.pay ? b.pay.children : [])];
          const target = b.net < 0 ? rack : seat;
          chips.forEach(c => moves.push(flyTo(c, target, { duration: 420, delay: moves.length * 25, lift: b.net < 0 ? 0 : 50, fade: true })));
        });
      });
      await Promise.all(moves);
      results.forEach((bets, i) => {
        const npc = seats[i];
        bets.forEach(b => { b.stack.remove(); b.pay?.remove(); });
        npc.bets = [];
        if (!bets.length) return;
        const back = bets.reduce((a, b) => a + Math.max(0, b.stake + b.net), 0);
        const net = bets.reduce((a, b) => a + b.net, 0);
        setChips(npc, npc.chips + back);
        npc.node.classList.remove('is-up', 'is-down');
        void npc.node.offsetWidth;
        if (net) npc.node.classList.add(net > 0 ? 'is-up' : 'is-down');
        if (Math.random() < (net > 0 ? 0.45 : 0.18)) say(npc, pick(net > 0 ? WIN : LOSE));
      });
      // Anyone who can no longer cover the minimum tops up from the cage.
      seats.forEach(npc => { if (npc.chips < t.tier.min) { buyIn(npc); say(npc, '칩 좀 바꿔 올게요'); } });
      if (!reducedMotion()) await wait(150);
    }
  };
}
