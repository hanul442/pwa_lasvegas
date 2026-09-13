# SOCIAL VEGAS

A fictional-chip social table-game project. **CH has no real-world monetary value and cannot be purchased, withdrawn, exchanged, or redeemed for prizes.**

## PWA readiness

The web client includes a Web App Manifest, service worker, standalone display metadata, install prompt hook and offline app shell. Authoritative `/api/*` game/economy responses are intentionally never cached. Game play and CH mutations still require an online server connection.

## Current executable build

Implemented now:

- Server-authoritative bankroll state with append-only ledger events
- 100,000,000 CH initial bankroll
- 50,000,000 CH recharge target, 4-hour cooldown, 3/day policy
- Extra recharge request + admin approval queue
- Permanent Vegas floor unlocks based on qualified gameplay P/L
- Separate Wealth / Qualified Profit / High Roller rankings
- Blackjack (deal / hit / stand / double, 3:2 natural, dealer S17)
- Baccarat (Punto Banco third-card rules, Player / Banker / Tie)
- European Roulette (red/black, odd/even, low/high, straight 17 demo)
- Sic Bo (big/small, odd/even, total 10 demo, any triple)
- Bankruptcy event + fictional price-comparison card data
- Responsive Vegas-inspired lobby, cashier, profile ledger, rankings and admin control room
- Production Supabase foundation migration with RLS-first read access

Card Room UI/contracts for Hold'em, 섯다 and 맞고 are present as the next build boundary; the full PvP engines from Sprint 4/5 are intentionally not faked in this executable build.

## Run

Requires Node.js 22+ and no npm dependencies.

```bash
npm start
```

Open `http://localhost:3000`.

## Tests

```bash
npm test
npm run verify
```

## Architecture notes

The executable demo persists to `data/state.json` so it can run without external dependencies. This is a local/demo adapter, not the production data store. The production schema is prepared in `supabase/migrations/0001_foundation.sql`; connect a dedicated Supabase project before public deployment.

Economy invariants:

1. CH mutations are server-side only.
2. Blackjack reserves stake in `locked` balance before player actions.
3. Admin and recharge grants do not change qualified gameplay P/L or floor progression.
4. House-game settlements update raw and qualified P/L together.
5. Floor unlocks persist after subsequent losses.
6. No endpoint implements real-money deposits, withdrawals, cash-out, crypto, prizes, or transfers.

## Production next step

Use `hanul442/pwa_lasvegas` as the dedicated GitHub repository, then create a dedicated Supabase project, apply the migration, replace the JSON store with Postgres transactions, add Supabase Auth, then deploy the Node service to Railway. Do not reuse the Black Oracle database or Railway service.
