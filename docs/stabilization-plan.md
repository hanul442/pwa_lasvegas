# SOCIAL VEGAS Stabilization / UI Overhaul Gate

Current priority is correctness and interaction stability before adding new game breadth.

P0 gates:
- Blackjack: recover/reload active multi-spot rounds without losing access to locked CH.
- Blackjack: surface action/API errors in-table instead of console-only failures.
- Baccarat / Roulette / Sic Bo: add duplicate-submit guards and result-to-animation consistency.
- Mobile: verify modal/table vertical scrolling and prevent background scroll lock regressions.
- Economy: visible bankroll and ledger settlement must remain consistent after every round.

P1 Vegas overhaul:
- Shared casino table shell and motion tokens.
- Baccarat deal/flip sequence.
- Roulette wheel/ball result replay.
- Sic Bo throw/bounce/settle sequence.
- Lobby/floor/VIP visual overhaul under the approved Maximal Vegas direction.

Safety boundary: CH remains fictional and non-redeemable. No deposits, withdrawals, cash-out, purchasing of redeemable chips, or real-money wagering.
