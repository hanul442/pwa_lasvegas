# SOCIAL VEGAS

A fictional-chip social table-game project. **CH has no real-world monetary value and cannot be purchased, withdrawn, exchanged, or redeemed for prizes.**

## Live preview

- Site and API: https://pwa-lasvegas.kimwriter222.workers.dev (one Cloudflare Worker, see `worker/` and `wrangler.toml`)
- GitHub: https://github.com/hanul442/pwa_lasvegas
- Current deployment is a **preview build**. There is no login yet, so do not treat demo player switching as real identity.

## Deploy

Cloudflare Workers Builds is connected to this repository: a push to `main` deploys to production and other branches get preview builds.

- `public/` is served as the Worker's static assets, and `/api/*` runs the game API (`lib/api.mjs`).
- One Durable Object (`VegasFloor`) keeps the floor's state and applies bets one at a time.
- Locally, `npm run dev` runs the same API on Node with a JSON file store, and `npx wrangler dev` runs the Worker.

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
- Live, playable tables in the web client for Blackjack, Baccarat, Roulette and Sic Bo, wired to the server API
- Physical table feel: cards dealt from the shoe with 3D flips and baccarat squeeze, chips tapped or dragged onto the felt, a roulette rotor and ball that land on the server's number, dice that tumble to the server's roll, payouts and rakes animated on the felt, synthesized table sounds and haptics (all respect reduced-motion)
- A dealer who calls the game in a deep English voice ("No more bets", "Your action", "All in", "Straight", "Two go"): 96 short recordings in `public/voice/`, rendered offline by `scripts/voice/generate.py`, cached for offline play and silenced by the same ♪ toggle
- Responsive Vegas-inspired lobby, rankings and profile ledger (client code in `public/js/`, no build step)
- Production Supabase foundation migration with RLS-first read access

- Card Room: 맞고 (two-player Go-Stop) and 섯다 against a house AI, with server-side engines (`lib/matgo.mjs`, `lib/seotda.mjs`), a drawn 48-card hwatu deck, and seats that a second human can take once friends play lands
- Interactive table guides: a coach that highlights the real table step by step and waits for the player to try each action, plus a rules sheet behind the "?" button for every game (`public/js/guide.js`, `public/js/guides.js`)

## Run

Requires Node.js 22+ and no npm dependencies.

```bash
npm start
```

Open `http://localhost:3000`.

## Tests

```bash
npm test
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

The site and API are deployed from `main`. Next, create a dedicated Supabase project, apply the migration, replace the JSON store with Postgres transactions and add Supabase Auth before sharing the app as a real friends-only service. Do not reuse the Black Oracle or gnomon databases.
