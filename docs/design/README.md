# VEGAS Design Reference

This directory stores approved visual direction references for the VEGAS PWA. These are implementation references, not production UI assets and not instructions to copy any third-party casino product literally.

## Source of truth

The canonical production wordmark is **`/public/assets/vegas-logo.svg`**. It is the thin geometric metallic-gold `VEGAS` wordmark with the four-point star glint inside the `A`, on black. Do not substitute alternate serif, crown, monogram, or heavy-display VEGAS logos in future UI work.

Reference boards:

- `vegas-desktop-lobby-concept.jpg` — desktop lobby + gameplay visual direction. Use for information hierarchy, black/gold material system, table-card density, VIP treatment, and cinematic casino ambience.
- `vegas-mobile-landscape-concept.jpg` — primary responsive target for landscape phones: brand masthead, game-first navigation, hero area, horizontal game cards, challenge/VIP modules, and touch-friendly controls.

## V2 implementation direction

Core direction: deep black / graphite surfaces, warm metallic gold, controlled glow, premium casino-floor ambience, strong game imagery, subtle emerald felt / casino-red accents, and animation-led feedback without sacrificing legibility.

The V2 shell is layered on top of the existing runtime so game, bankroll, ledger, payout and settlement behavior remain independently auditable and rollback-friendly.

### Game family

Current live family:

- Blackjack
- Baccarat
- Roulette
- Sic Bo

Expansion family using the same brand system:

- Texas Hold'em
- 맞고
- 섯다
- future slots / VIP special tables

V2 vector lobby artwork lives under `/public/assets/ui-v2/` so each game has a consistent thumbnail treatment without tying runtime UI to generated raster mockups.

## Interaction principles

1. Mobile landscape is a first-class layout, not a shrunk desktop view.
2. Lobby -> game entry should be visually obvious in one tap.
3. Blackjack cards deal, roulette wheel spins, dice throw, chips move, and win/loss moments receive purposeful animation.
4. Keep bankroll, stake tier, current bet, session result, and exit/back controls continuously understandable.
5. Prefer cinematic depth and physical casino cues over generic dashboard cards.
6. Preserve vertical/horizontal scrolling and safe-area behavior on mobile.
7. Visual changes must not silently alter payout, wager, ledger, settlement or idempotency semantics.
8. 맞고 / 섯다 should feel native to the VEGAS brand rather than visually detached Korean mini-games.

## Active implementation files

- `/public/vegas-ui-v2.css` — V2 shell, lobby and responsive treatment.
- `/public/vegas-ui-v2-assets.css` — canonical asset bindings.
- `/public/vegas-ui-v2.js` — idempotent presentation adapter applied after existing renders.
- `/public/assets/vegas-logo.svg` — canonical brand wordmark.
- `/public/assets/ui-v2/` — per-game vector artwork.

## Implementation note

The checked-in JPG boards are lightweight references. Production artwork should live under `public/assets/` after optimization and ownership review. When mockups and code disagree, the canonical wordmark rule and the mobile-landscape interaction principles above take precedence.
