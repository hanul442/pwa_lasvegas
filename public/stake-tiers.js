let stakeTierBands = [];

export function setStakeTierBands(bands = []) {
  stakeTierBands = Array.isArray(bands)
    ? bands.filter(tier => tier && typeof tier.slug === 'string' && Number.isSafeInteger(tier.minBet) && Number.isSafeInteger(tier.maxBet))
    : [];
  return stakeTierBands;
}

export function stakeTierForUi(stake, bands = stakeTierBands) {
  if (!Number.isSafeInteger(stake) || stake <= 0) return null;
  return bands.find(tier => stake >= tier.minBet && stake <= tier.maxBet) ?? null;
}

function tierLabel(slugs = []) {
  return slugs.map(slug => slug.toUpperCase()).join(' · ');
}

async function fetchState() {
  const playerId = localStorage.getItem('sv-player') || 'hanseo';
  const response = await fetch('/api/state', { headers: { 'x-player-id': playerId } });
  if (!response.ok) throw new Error('STAKE_TIER_STATE_FAILED');
  return response.json();
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function decorateBets(bands) {
  const buttons = [...document.querySelectorAll('[data-bet]')];
  for (const button of buttons) {
    const tier = stakeTierForUi(Number(button.dataset.bet), bands);
    if (!tier) continue;
    let tag = button.querySelector('.stake-tier-chip');
    if (!tag) {
      tag = document.createElement('small');
      tag.className = 'stake-tier-chip';
      button.append(tag);
    }
    setText(tag, tier.name);
  }

  const active = buttons.find(button => button.classList.contains('on'));
  const chips = active?.closest('.chips');
  if (!active || !chips) return;
  const tier = stakeTierForUi(Number(active.dataset.bet), bands);
  if (!tier) return;
  let current = chips.previousElementSibling;
  if (!current?.classList.contains('stake-tier-current')) {
    current = document.createElement('div');
    current.className = 'stake-tier-current';
    chips.before(current);
  }
  setText(current, `SELECTED STAKE · ${tier.name}`);
}

function decorateFloors(state) {
  const floorMap = new Map((state.floors || []).map(floor => [floor.slug, floor]));
  for (const button of document.querySelectorAll('.floor-grid [data-floor]')) {
    const floor = floorMap.get(button.dataset.floor);
    if (!floor?.stakeTiers?.length) continue;
    const card = button.closest('article');
    if (!card) continue;
    let summary = card.querySelector('.stake-tier-summary');
    if (!summary) {
      summary = document.createElement('p');
      summary.className = 'stake-tier-summary';
      button.before(summary);
    }
    setText(summary, `Stake Tier · ${tierLabel(floor.stakeTiers)}`);
  }

  const currentSlug = localStorage.getItem('sv-floor') || 'strip';
  const currentFloor = floorMap.get(currentSlug) || (state.floors || []).find(floor => floor.unlocked);
  if (!currentFloor?.stakeTiers?.length) return;
  for (const section of document.querySelectorAll('section.block')) {
    const heading = section.querySelector('.section-title h2');
    if (heading?.textContent !== 'TABLES') continue;
    let badge = section.querySelector('.table-tier-summary');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'table-tier-summary';
      section.querySelector('.section-title')?.after(badge);
    }
    setText(badge, `AVAILABLE STAKES · ${tierLabel(currentFloor.stakeTiers)}`);
  }
}

let scheduled = false;

async function decorate() {
  try {
    const latestState = await fetchState();
    const bands = setStakeTierBands(latestState.stakeTiers);
    decorateFloors(latestState);
    decorateBets(bands);
  } catch {
    // Fail closed: tier labels are metadata, so do not invent local boundaries when API state is unavailable.
  }
}

function scheduleDecorate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(async () => {
    scheduled = false;
    await decorate();
  });
}

if (typeof document !== 'undefined') {
  addEventListener('DOMContentLoaded', scheduleDecorate, { once: true });
  new MutationObserver(scheduleDecorate).observe(document.documentElement, { childList: true, subtree: true });
}
