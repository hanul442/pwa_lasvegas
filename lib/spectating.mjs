const SPECTATABLE_STATUSES = new Set(['PLAYER', 'READY_TO_SETTLE']);

function knownUser(state, userId) {
  return typeof userId === 'string' && Boolean(state?.users?.[userId]);
}

function publicParticipant(state, userId) {
  const user = state.users[userId];
  return user ? { id: user.id, nickname: user.nickname, accent: user.accent } : null;
}

function cardText(card) {
  if (!card || typeof card.r !== 'string' || typeof card.s !== 'string') return null;
  return `${card.r}${card.s}`;
}

function blackjackPublicState(round) {
  if (!Array.isArray(round.dealer) || round.dealer.length < 1) return null;
  const dealerUpCard = cardText(round.dealer[0]);
  if (!dealerUpCard) return null;

  if (Array.isArray(round.hands) && round.hands.length > 0) {
    const hands = round.hands.map(hand => {
      if (!Array.isArray(hand?.cards) || hand.cards.length < 2) return null;
      const cards = hand.cards.map(cardText);
      if (cards.some(card => !card)) return null;
      return {
        spot: Number.isInteger(hand.spot) ? hand.spot : null,
        cards,
        doubled: Boolean(hand.doubled),
        fromSplit: Boolean(hand.fromSplit)
      };
    });
    if (hands.some(hand => !hand)) return null;
    return {
      playerCards: hands[0].cards,
      hands,
      dealerCards: [dealerUpCard, 'HIDDEN'],
      doubled: hands[0].doubled,
      multiSpot: true
    };
  }

  if (!Array.isArray(round.player)) return null;
  const playerCards = round.player.map(cardText);
  if (playerCards.some(card => !card)) return null;
  return {
    playerCards,
    dealerCards: [dealerUpCard, 'HIDDEN'],
    doubled: Boolean(round.doubled),
    multiSpot: false
  };
}

function normalizeRound(state, round) {
  if (!round || typeof round.id !== 'string' || !knownUser(state, round.userId)) return null;
  if (!SPECTATABLE_STATUSES.has(round.status)) return null;
  if (round.game !== 'Blackjack') return null;

  const gameState = blackjackPublicState(round);
  if (!gameState) return null;

  return {
    roundId: round.id,
    game: 'Blackjack',
    floor: typeof round.floor === 'string' ? round.floor : null,
    participant: publicParticipant(state, round.userId),
    status: round.status,
    openedAt: round.createdAt ?? null,
    gameState
  };
}

export function buildSpectatingSnapshot(state, viewerId) {
  if (!knownUser(state, viewerId)) throw new Error('USER_NOT_FOUND');

  const tables = Array.isArray(state.rounds)
    ? state.rounds.map(round => normalizeRound(state, round)).filter(Boolean)
    : [];

  return {
    mode: 'READ_ONLY',
    tables,
    capabilities: {
      spectating: true,
      interaction: false,
      sideBets: false,
      chipTransfer: false,
      hiddenCardsExposed: false
    }
  };
}
