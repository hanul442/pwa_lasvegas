// Card Room API: 맞고 against the house AI and 섯다 against a table of AI players. The human
// always sits in seat 0; the other seats are AI today and can become friends once tables exist.
import { lockBet, increaseBetLock, settleLockedHouseGame } from './economy.mjs';
import { isBlackjackCommandReplay as isCommandReplay, recordBlackjackCommand as recordCommand, tagBlackjackStart as tagStart } from './blackjack-idempotency.mjs';
import { normalizeIdempotencyKey } from './instant-idempotency.mjs';
import { startMatgo, matgoAct, runMatgoAi, matgoPublic, matgoNet, MATGO_DEPOSIT_POINTS } from './matgo.mjs';
import { startSeotda, seotdaAct, seotdaActionCost, runSeotdaAi, seotdaPublic, seotdaNet, seotdaSeats } from './seotda.mjs';

const HUMAN = 0;
const GAMES = {
  matgo: { game: 'Matgo', open: 'OPEN_MATGO_ROUND' },
  seotda: { game: 'Seotda', open: 'OPEN_SEOTDA_ROUND' }
};

const openRound = (state, userId, game) => state.rounds.find(r => r.userId === userId && r.game === game && r.status !== 'SETTLED') || null;

function startReplay(state, { userId, game, key, fingerprint }) {
  if (!key) return null;
  for (let i = state.rounds.length - 1; i >= 0; i--) {
    const r = state.rounds[i];
    if (r?.userId !== userId || r.game !== game || r.idempotency?.start?.key !== key) continue;
    if (r.idempotency.start.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
    return r;
  }
  return null;
}

// ---------- settlement ----------
function settleMatgo(state, user, round) {
  const deposit = round.deposit;
  let net = matgoNet(round, HUMAN);
  let locked = deposit;
  // Losses past the deposit come out of the rest of the bankroll, as far as it goes.
  if (net < -deposit) {
    const extra = Math.min(user.account.available, -net - deposit);
    if (extra > 0) { increaseBetLock(state, user, { stake: extra, game: 'Matgo', roundId: round.id, metadata: { reason: 'POINTS_OVER_DEPOSIT' } }); locked += extra; }
    net = Math.max(net, -locked);
  }
  settleLockedHouseGame(state, user, { game: 'Matgo', stake: locked, netPnl: net, roundId: round.id, wagered: Math.max(round.stake, Math.abs(net)), details: { points: round.result?.points ?? 0, winner: round.result?.winner, reason: round.result?.reason } });
  round.status = 'SETTLED';
  round.netPnl = net;
}

// Only the human's own contributions are locked; the AI seats' money is virtual and the human
// can win it. Net is what the human takes from the pot minus what they put in.
function settleSeotda(state, user, round) {
  const net = seotdaNet(round, HUMAN);
  settleLockedHouseGame(state, user, { game: 'Seotda', stake: round.contrib[HUMAN], netPnl: net, roundId: round.id, details: { winner: round.result?.winner, winners: round.result?.winners, reason: round.result?.reason, hands: round.result?.hands, players: round.hands.length } });
  round.status = 'SETTLED';
  round.netPnl = net;
}

function view(slug, round) { return slug === 'matgo' ? matgoPublic(round, HUMAN) : seotdaPublic(round, HUMAN); }

// Returns a response for /api/matgo/* and /api/seotda/*, or null for any other path.
export async function handleCardRoom(req, url, { mutate, loadState, getUser, summarize, validateStake }) {
  const m = url.pathname.match(/^\/api\/(matgo|seotda)\/(open|start|action)$/);
  if (!m) return null;
  const [, slug, verb] = m;
  const { game, open } = GAMES[slug];
  // Events describe the table as the human seat saw it: an opponent's dealt card stays face down.
  const visible = events => events.map(e => (e.type === 'deal' && e.seat !== HUMAN ? { ...e, card: 'HIDDEN' } : e));
  const respond = (round, state, user, events = [], replayed = false) => ({ status: 200, data: { round: view(slug, round), events: visible(events), replayed, netPnl: round.status === 'SETTLED' ? round.netPnl : null, state: summarize(state, user) } });

  if (verb === 'open' && req.method === 'GET') {
    const state = await loadState();
    const user = getUser(state, req);
    const round = openRound(state, user.id, game);
    return { status: 200, data: { round: round ? view(slug, round) : null, floor: round?.venue ?? null, state: summarize(state, user) } };
  }
  if (req.method !== 'POST') return null;
  const body = await req.body();
  const key = normalizeIdempotencyKey(req.header('x-idempotency-key'));

  if (verb === 'start') {
    return mutate(state => {
      const user = getUser(state, req);
      const stake = Number(body.stake), floor = body.floor || 'downtown';
      const players = slug === 'seotda' ? Number(body.players ?? 4) : 2;
      const fingerprint = JSON.stringify(slug === 'seotda' ? { kind: 'START', game, stake, floor, players } : { kind: 'START', game, stake, floor });
      const replay = startReplay(state, { userId: user.id, game, key, fingerprint });
      if (replay) return respond(replay, state, user, [], true);
      validateStake(user, floor, stake);
      if (openRound(state, user.id, game)) throw new Error(open);
      const human = { kind: 'human', userId: user.id };
      const seats = slug === 'seotda' ? seotdaSeats(players, human) : [human, { kind: 'ai', name: '하우스 AI' }];
      const events = [];
      let round;
      if (slug === 'matgo') {
        round = startMatgo({ stake, seats });
        round.deposit = stake * MATGO_DEPOSIT_POINTS;
        if (user.account.available < round.deposit) throw new Error('INSUFFICIENT_BANKROLL');
        lockBet(state, user, { stake: round.deposit, game, roundId: round.id, metadata: { pointValue: stake } });
      } else {
        round = startSeotda({ stake, seats, events });
        lockBet(state, user, { stake, game, roundId: round.id, metadata: { ante: stake } });
      }
      round.userId = user.id;
      round.venue = floor; // casino floor slug; round.floor is the 맞고 card floor
      tagStart(round, key, fingerprint);
      state.rounds.push(round);
      if (slug === 'matgo') runMatgoAi(round, events); else runSeotdaAi(round, events);
      if (round.status === 'READY_TO_SETTLE') (slug === 'matgo' ? settleMatgo : settleSeotda)(state, user, round);
      return respond(round, state, user, events);
    });
  }

  if (verb === 'action') {
    return mutate(state => {
      const user = getUser(state, req);
      const round = state.rounds.find(r => r.id === body.roundId && r.userId === user.id && r.game === game);
      if (!round) throw new Error('ROUND_NOT_FOUND');
      const fingerprint = JSON.stringify({ kind: 'ACTION', roundId: round.id, type: body.type ?? null, action: body.action ?? null, card: body.card ?? null, target: body.target ?? null, month: body.month ?? null, shake: Boolean(body.shake) });
      if (isCommandReplay(round, key, fingerprint)) return respond(round, state, user, [], true);
      if (round.status !== 'PLAYING') throw new Error('ROUND_NOT_ACTIONABLE');
      const events = [];
      if (slug === 'matgo') {
        matgoAct(round, HUMAN, { type: body.type, card: body.card, target: body.target, month: body.month, shake: Boolean(body.shake) }, events);
        runMatgoAi(round, events);
        if (round.status === 'READY_TO_SETTLE') settleMatgo(state, user, round);
      } else {
        const cost = seotdaActionCost(round, HUMAN, body.action);
        if (cost > 0) {
          if (user.account.available < cost) throw new Error('INSUFFICIENT_BANKROLL');
          increaseBetLock(state, user, { stake: cost, game, roundId: round.id, metadata: { action: body.action, street: round.street } });
        }
        seotdaAct(round, HUMAN, body.action, events);
        runSeotdaAi(round, events);
        if (round.status === 'READY_TO_SETTLE') settleSeotda(state, user, round);
      }
      recordCommand(round, key, fingerprint);
      return respond(round, state, user, events);
    });
  }
  return null;
}
