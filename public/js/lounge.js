// The lobby's daily layer: 일급·주급·월급, today's missions, the lucky-card rescue,
// the lounge news feed and the floor-unlock moment.
import { api, playerId } from './api.js';
import { el, formatCH, formatMoney, sound, haptic, flyTo, animate, wait } from './fx.js';
import { createChip, TIERS, FIRST_TIER } from './chips.js';
import { duelInviteBlock } from './social.js';
import { errorToast } from './notice.js';
import { gameName } from './names.js';
import { bragButton } from './share.js';
import { bragFloor } from './brags.js';

export { gameName };

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }

// Chips spill from `from` into the wallet in the top bar.
export async function chipsToWallet(from, amount) {
  const wallet = document.querySelector('.wallet');
  if (!from || !wallet) return;
  const start = from.getBoundingClientRect();
  const target = wallet.getBoundingClientRect();
  // Chips from the table whose rack suits the amount, so 300만 doesn't fly in as 5억 plaques.
  const tier = Object.values(TIERS).filter(t => t.min * 5 <= amount).at(-1) || FIRST_TIER;
  const denoms = tier.chips;
  const count = Math.min(10, 4 + Math.floor(Math.log10(Math.max(1, amount / tier.min)) * 2));
  const flights = [];
  for (let i = 0; i < count; i++) {
    const chip = createChip(denoms[i % denoms.length]);
    chip.classList.add('chip-flyer');
    chip.style.left = `${start.left + start.width / 2 - 20 + (Math.random() * 40 - 20)}px`;
    chip.style.top = `${start.top + start.height / 2 - 20 + (Math.random() * 20 - 10)}px`;
    document.body.append(chip);
    flights.push(flyTo(chip, target, { duration: 620, delay: i * 55, lift: 80, fade: true }).then(() => chip.remove()));
  }
  sound.chips(Math.min(8, count));
  haptic([12, 40, 12, 40, 20]);
  await Promise.all(flights);
  animate(wallet, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 360, fill: 'none' });
}

// ---------- pay: 일급, 주급, 월급 ----------
// This week of the 28-day pay calendar: seven days of 일급, with 주급 on the seventh and 월급
// on the last day of the fourth week.
function dayStrip(daily) {
  const strip = el('ol', 'daily-strip');
  const first = daily.day - ((daily.day - 1) % 7);
  for (let day = first; day < first + 7; day++) {
    const done = daily.claimed ? day <= daily.day : day < daily.day;
    const today = day === daily.day;
    const weekly = day % 7 === 0, monthly = day === 28;
    const amount = daily.rates.daily + (weekly ? daily.rates.weekly : 0) + (monthly ? daily.rates.monthly : 0);
    const li = el('li', `daily-day${done ? ' is-done' : ''}${today ? ' is-today' : ''}${weekly ? ' is-vault' : ''}`);
    li.innerHTML = `<span>${monthly ? '월급' : weekly ? '주급' : `${day - first + 1}일`}</span><b>${formatCH(amount)}</b>`;
    strip.append(li);
  }
  return strip;
}

function weekDots(daily) {
  const week = Math.ceil(daily.day / 7);
  const dots = el('ol', 'pay-weeks');
  dots.setAttribute('aria-label', `이번 달 ${week}주차, 4주를 채우면 월급`);
  for (let w = 1; w <= 4; w++) dots.append(el('li', `${w < week || (w === week && daily.claimed && daily.day % 7 === 0) ? 'is-done' : ''}${w === week ? ' is-now' : ''}`, `${w}주`));
  return dots;
}

let dailyOpen = false;
export function openDailySheet(state, onChanged, { onClose } = {}) {
  const daily = state.engagement.daily;
  if (daily.claimed || dailyOpen) return false;
  dailyOpen = true;
  const scrim = el('div', 'lounge-scrim');
  const sheet = el('section', 'lounge-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'daily-title');
  const extra = daily.pay.monthly ? '오늘은 일급에 주급, 월급까지 나와요.' : daily.pay.weekly ? '오늘은 일급에 주급까지 나와요.' : `주급까지 ${daily.toWeekly}일, 월급까지 ${daily.toMonthly}일 남았어요.`;
  const streakText = daily.streak > 0 ? `${daily.streak}일 연속 출근 중이에요. ` : '오늘부터 연속 출근을 시작해요. ';
  sheet.innerHTML = `<p class="lounge-eyebrow">오늘의 급여</p><h2 id="daily-title">+${formatCH(daily.reward)}</h2><p class="lounge-note">${streakText}${extra} 하루라도 빠지면 처음부터 다시 세요.</p>`;
  sheet.append(dayStrip(daily), weekDots(daily));
  const actions = el('div', 'lounge-sheet-actions');
  const later = el('button', 'pill-button', '나중에');
  const claim = el('button', 'pill-button pill-button--solid', `+${formatCH(daily.reward)} 받기`);
  later.type = claim.type = 'button';
  actions.append(later, claim);
  sheet.append(actions);
  document.body.append(scrim, sheet);
  requestAnimationFrame(() => { scrim.classList.add('is-open'); sheet.classList.add('is-open'); claim.focus({ preventScroll: true }); });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dailyOpen = false;
    scrim.classList.remove('is-open'); sheet.classList.remove('is-open');
    removeEventListener('keydown', onKey, true);
    setTimeout(() => { scrim.remove(); sheet.remove(); onClose?.(); }, 320);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', close);
  later.addEventListener('click', close);
  claim.addEventListener('click', async () => {
    claim.disabled = true;
    try {
      const out = await api.dailyClaim();
      const today = sheet.querySelector('.daily-day.is-today');
      today?.classList.add('is-done');
      if (out.claim.pay?.weekly) await vaultOpen(sheet);
      await chipsToWallet(today || claim, out.claim.amount);
      onChanged(out.state);
      await wait(250);
      close();
    } catch (e) { claim.disabled = false; errorToast(e, () => claim.click()); }
  });
  return true;
}

// 주급 and 월급 days: the vault door swings open before the chips pour out.
async function vaultOpen(sheet) {
  const door = el('div', 'vault-door', '<span></span>');
  sheet.append(door);
  sound.win();
  await animate(door, [{ opacity: 0, transform: 'scale(.6) rotate(-90deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }], { duration: 700 });
  await animate(door.firstChild, [{ transform: 'rotate(0)' }, { transform: 'rotate(270deg)' }], { duration: 600 });
  await animate(door, [{ opacity: 1 }, { opacity: 0, transform: 'scale(1.4)' }], { duration: 400 });
  door.remove();
}

// The pay sheet opens from the home strip's pay card. The push-permission ask waits while it is up.
export function dailyDue() { return dailyOpen; }

// One tap: the bank row pays out where it sits.
export async function claimDaily(from, onChanged) {
  from.disabled = true;
  try {
    const out = await api.dailyClaim();
    await chipsToWallet(from, out.claim.amount);
    onChanged(out.state);
  } catch (e) { from.disabled = false; errorToast(e, () => claimDaily(from, onChanged)); }
}

// ---------- missions ----------
function untilText(iso) {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

export function missionsBlock(state, onChanged) {
  const ms = state.engagement.missions;
  const box = el('section', 'lounge-block');
  const claimedAll = ms.items.every(i => i.claimed);
  box.innerHTML = `<header class="lounge-head"><h2>오늘의 미션</h2><small>${untilText(ms.nextAt)} 뒤 새로 나와요</small></header>`;
  const list = el('ul', 'mission-list');
  for (const m of ms.items) {
    const li = el('li', `mission${m.done ? ' is-done' : ''}${m.claimed ? ' is-claimed' : ''}`);
    li.innerHTML = `<div class="mission-text"><span>${m.label}</span><small>${m.progress} / ${m.target} · 보상 ${formatCH(m.reward)}</small><span class="mission-bar"><i style="width:${Math.round((m.progress / m.target) * 100)}%"></i></span></div>`;
    if (m.done && !m.claimed) {
      const b = el('button', 'pill-button pill-button--solid mission-claim', '받기');
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const out = await api.missionClaim(m.id);
          await chipsToWallet(b, out.claim.amount + out.claim.bonus);
          onChanged(out.state);
        } catch (e) { b.disabled = false; errorToast(e, () => b.click()); }
      });
      li.append(b);
    } else {
      li.append(el('span', 'mission-state', m.claimed ? '완료' : ''));
    }
    list.append(li);
  }
  box.append(list);
  box.append(el('p', 'lounge-note', ms.swept || claimedAll ? '오늘 미션을 모두 끝냈어요. 내일 또 만나요.' : `세 개를 모두 받으면 보너스 +${formatCH(ms.sweepBonus)}`));
  return box;
}

// ---------- lucky card rescue ----------
function rescueBlock(state, onChanged) {
  const rescue = state.engagement.rescue;
  const box = el('section', 'lounge-block lounge-block--rescue');
  box.innerHTML = `<header class="lounge-head"><h2>럭키 카드</h2><small>칩이 바닥났을 때 한 시간에 한 번</small></header><p class="lounge-note">세 장 중 한 장을 골라요. 최대 ${formatCH(Math.max(...rescue.prizes))}까지 들어 있어요.</p>`;
  const row = el('div', 'rescue-cards');
  const cards = [0, 1, 2].map(i => {
    const c = el('button', 'rescue-card', '<span class="rescue-back"></span><span class="rescue-face"></span>');
    c.type = 'button';
    c.setAttribute('aria-label', `${i + 1}번째 카드 고르기`);
    c.addEventListener('click', async () => {
      cards.forEach(x => { x.disabled = true; });
      try {
        const out = await api.rescue(i);
        out.rescue.cards.forEach((amount, j) => { cards[j].querySelector('.rescue-face').textContent = `+${formatCH(amount)}`; });
        c.classList.add('is-flipped', 'is-picked');
        sound.flip(); haptic(20);
        await wait(700);
        cards.forEach((x, j) => { if (j !== i) x.classList.add('is-flipped'); });
        await wait(500);
        await chipsToWallet(c, out.rescue.amount);
        onChanged(out.state);
      } catch (e) { cards.forEach(x => { x.disabled = false; }); errorToast(e, () => c.click()); }
    });
    row.append(c);
    return c;
  });
  box.append(row);
  return box;
}

// ---------- lounge feed ----------
function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export function feedText(f) {
  const who = f.nickname || '누군가';
  switch (f.type) {
    case 'HOT_WIN': return f.multiple >= 5 ? `${who}님 대박! ${gameName(f.game)}에서 ${f.multiple}배 적중, ${formatMoney(f.amount)} 벌었어요` : `${who}님 대박! ${gameName(f.game)}에서 ${formatMoney(f.amount)} 벌었어요`;
    case 'JACKPOT': return `${who}님이 잭팟을 터뜨려 ${formatMoney(f.amount)} 벌었어요`;
    case 'INVITE': return `${who}님이 친구 ${f.friend}님을 데려와 둘 다 ${formatMoney(f.amount)} 받았어요`;
    case 'DAILY_STREAK': return `${who}님이 7일 연속 출근해서 주급을 받았어요`;
    case 'MONTHLY_PAY': return `${who}님이 28일 개근으로 월급 ${formatMoney(f.amount)}을 받았어요`;
    case 'PERSONAL_BANKRUPTCY': return `${who}님이 빚 ${formatMoney(f.amount)}을 안고 파산 신청했어요`;
    case 'HAND_BOOK': return `${who}님이 족보 도감에 「${f.text}」 칸을 채웠어요`;
    case 'ACHIEVEMENT': return `${who}님이 업적 「${f.text}」을 달성했어요`;
    case 'SEASON_WINNER': return `${who}님이 ${f.season} 1위를 차지했어요`;
    case 'FLOOR_UNLOCK': return f.text?.replace(/^(.+) unlocked (.+)\.$/, '$1님이 $2 층에 올라섰어요') || '';
    case 'BANKRUPTCY': return f.amount ? `${who}님 파산! ${gameName(f.game)}에서 ${formatMoney(f.amount)} 날리고 빈털터리` : `${who}님이 파산했어요. 다시 일어설 수 있을까요?`;
    case 'BIG_LOSS': return f.amount ? `${who}님이 ${f.game ? gameName(f.game) : '큰 판'}에서 ${formatMoney(f.amount)}을 잃었어요` : `${who}님이 큰 판에서 졌어요`;
    case 'LUXURY': return `${who}님이 ${f.name}${/[가-힣]$/.test(f.name || '') && (f.name.charCodeAt(f.name.length - 1) - 0xac00) % 28 ? '을' : '를'} ${formatMoney(f.amount)}에 샀어요`;
    case 'BIG_WIN': return f.text || '';
    case 'CHALLENGE_WON': return `${who}님이 ${f.opponent}님과의 대결에서 이겼어요`;
    default: return f.text || '';
  }
}

// 동네방네: under someone else's moment, 👏🔥😂 with counts; under mine, just the counts.
const REACTS = [['clap', '👏', '축하해요'], ['fire', '🔥', '대단해요'], ['lol', '😂', '웃겨요']];
function reactRow(f, mine, onChanged) {
  const row = el('div', 'feed-react');
  const paint = react => {
    const counts = react?.counts || {};
    row.replaceChildren(...REACTS.map(([kind, emoji, label]) => {
      const n = counts[kind] || 0;
      if (mine && !n) return null;
      const b = el('button', `feed-react-btn${react?.mine === kind ? ' is-on' : ''}`, `${emoji}${n ? `<small>${n}</small>` : ''}`);
      b.type = 'button';
      b.setAttribute('aria-label', `${label}${n ? ` ${n}명` : ''}`);
      b.setAttribute('aria-pressed', String(react?.mine === kind));
      if (mine) { b.disabled = true; return b; }
      b.addEventListener('click', async () => {
        sound.tick(); haptic(8);
        // Show it straight away; the server's count follows.
        const was = react?.mine;
        const next = { counts: { ...counts }, mine: was === kind ? null : kind };
        if (was) next.counts[was] = Math.max(0, (next.counts[was] || 0) - 1);
        if (next.mine) next.counts[kind] = (next.counts[kind] || 0) + 1;
        f.react = next; paint(next);
        if (next.mine) animate(row.querySelector('.is-on'), [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 320 });
        try { const out = await api.feedReact(f.id, next.mine || ''); f.react = out.react; paint(out.react); onChanged?.(out.state); }
        catch (e) { f.react = react; paint(react); errorToast(e); }
      });
      return b;
    }).filter(Boolean));
  };
  paint(f.react);
  return row;
}

export function feedBlock(state, onChanged) {
  const items = (state.engagement.feed || []).filter(f => f.type !== 'SYSTEM').slice(0, 8);
  const box = el('section', 'lounge-block');
  box.innerHTML = '<header class="lounge-head"><h2>라운지 소식</h2><small>축하하거나 놀려 주세요</small></header>';
  const list = el('ul', 'feed-list');
  if (!items.length) list.append(el('li', 'feed-empty', '아직 조용해요. 첫 번째 큰 승리를 만들어 보세요.'));
  const me = state.user?.id;
  for (const f of items) {
    const li = el('li', `feed-item feed-item--${f.type.toLowerCase().replace(/_/g, '-')}`);
    li.innerHTML = `<div class="feed-main"><span>${feedText(f)}</span><small>${ago(f.createdAt)}</small></div>`;
    if (f.actorId) li.append(reactRow(f, f.actorId === me, onChanged));
    list.append(li);
  }
  box.append(list);
  return box;
}

// ---------- floor ladder ----------
export function floorBlock(state, onPass) {
  const floors = state.floors || [];
  // The next floor still to enter: reached by net worth (unlocked) and holding its skin (passed).
  const next = floors.find(f => !f.entered && f.slug !== floors[0]?.slug);
  const box = el('section', 'lounge-block lounge-block--floor');
  const top = [...floors].reverse().find(f => f.entered || f === floors[0]);
  const open = floors.filter(f => f.open).map(f => f.name).join(' · ');
  if (!next) { box.innerHTML = `<header class="lounge-head"><h2>${top?.name}</h2><small>가장 높은 층에 있어요</small></header>`; return box; }
  const progress = next.unlocked ? 1 : next.progress;
  const todo = [
    next.unlocked ? '' : `순자산(보유 칩 − 빚)이 ${formatCH(next.remaining)} 더 모이고`,
    next.passed ? '' : `상점에서 ${next.name} 꾸미기를 하나 사면`
  ].filter(Boolean).join(', ');
  box.innerHTML = `<header class="lounge-head"><h2><small class="lounge-kicker">다음 층</small>${next.name}</h2><small>${Math.round(progress * 100)}%${next.passed ? ' · 입장권 보유' : ''}</small></header>
    <span class="mission-bar mission-bar--floor"><i style="width:${Math.round(progress * 100)}%"></i></span>
    <p class="lounge-note">${todo.replace(/고$/, '면')} 올라가요. 지금 앉을 수 있는 곳은 ${open}이에요.</p>`;
  if (!next.passed) {
    const b = el('button', `pill-button${next.unlocked ? ' pill-button--solid' : ''} floor-pass-go`, `${next.name} 꾸미기 보기`);
    b.type = 'button';
    b.addEventListener('click', () => onPass?.(next.slug));
    box.append(b);
  }
  return box;
}

// Home keeps only what needs an answer now: the lucky-card rescue and duel invites. Missions,
// the season and the hot table sit in the home strip; the feed is in 이벤트, the next floor in 지갑.
export function renderLounge(root, state, onChanged) {
  if (!state?.engagement) { root.replaceChildren(); return; }
  const blocks = [];
  if (state.engagement.rescue?.eligible) blocks.push(rescueBlock(state, onChanged));
  const invites = duelInviteBlock(state, onChanged);
  if (invites) blocks.push(invites);
  root.replaceChildren(...blocks);
}

// ---------- floor unlock moment ----------
// A floor counts once it can be entered: reached by net worth and its pass bought.
export function celebrateFloors(state) {
  if (!Array.isArray(state?.floors)) return;
  const unlocked = state.floors.filter(f => f.entered || f === state.floors[0]).map(f => f.slug);
  const key = `vegas:seen-floors:${playerId()}`;
  const seen = storageGet(key);
  storageSet(key, JSON.stringify(unlocked));
  if (seen === null) return; // first visit on this device: nothing to celebrate yet
  let before = [];
  try { before = JSON.parse(seen) || []; } catch {}
  const fresh = unlocked.filter(s => !before.includes(s));
  const floor = state.floors?.find(f => f.slug === fresh[fresh.length - 1]);
  if (floor) floorMoment(floor, state.user?.nickname || '');
}

function floorMoment(floor, nickname = '') {
  const node = el('div', 'floor-moment');
  node.setAttribute('role', 'status');
  node.innerHTML = `<div class="floor-moment-inner"><span class="floor-star" aria-hidden="true"></span><p>새 층이 열렸어요</p><h2>${floor.name}</h2><small>${formatCH(floor.minBet)} – ${formatCH(floor.maxBet)}원 테이블</small><div class="moment-actions"><button type="button" class="pill-button" data-close>입장하기</button></div></div>`;
  document.body.append(node);
  sound.win(); haptic([30, 60, 30, 60, 60]);
  requestAnimationFrame(() => node.classList.add('is-open'));
  const close = () => { clearTimeout(timer); node.classList.remove('is-open'); setTimeout(() => node.remove(), 400); };
  // Sharing holds the moment open until the player is back from the share sheet.
  const brag = bragButton(async () => { clearTimeout(timer); await bragFloor(floor, nickname); });
  node.querySelector('.moment-actions').prepend(brag);
  node.querySelector('[data-close]').addEventListener('click', close);
  brag.focus({ preventScroll: true });
  const timer = setTimeout(close, 6000);
}
