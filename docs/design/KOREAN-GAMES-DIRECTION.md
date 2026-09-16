# VEGAS Visual Expansion Direction

This file locks the visual direction for future VEGAS game and UI asset work.

## Source of truth

- `docs/design/vegas-mobile-landscape-concept.jpg`
- `docs/design/vegas-desktop-lobby-concept.jpg`
- `docs/design/assets/vegas-complete-asset-pack-reference.jpg`
- `docs/design/assets/vegas-korean-games-expansion-reference.jpg`
- `public/assets/vegas-logo.svg`

## Core visual language

- Deep black / graphite base
- Warm metallic Vegas gold as the primary accent
- Controlled casino glow rather than flat dashboard styling
- Emerald felt, casino red, royal blue/purple only as game/state accents
- Premium physical materials: felt, glass, brass/gold, leather, lacquered card surfaces
- Cinematic but implementation-friendly composition
- Mobile landscape is a first-class target
- Game objects should feel tactile and animated: deal, flip, spin, roll, chip movement, win/loss moments

## Expansion rule

Every new game should look like a different room inside the same VEGAS property. Do not redesign the brand per game. Keep logo, shell, navigation, typography hierarchy, gold treatment, card framing, chips, status badges, and result-feedback language consistent. Change only the game-specific table, objects, accent color, rule information, and signature animation.

## Planned game families

### Western casino
- Blackjack
- Roulette
- Baccarat
- Sic Bo
- Texas Hold'em / Poker
- Slots / jackpot-style machine games

### Korean card room
- 맞고 / 고스톱
- 섯다
- Optional future variants: 민화투-inspired casual modes, tournament/event rooms

## 맞고 visual direction

- Preserve the VEGAS black/gold shell; use dark emerald or deep lacquer-red table surfaces.
- Hanafuda / hwatu cards become the hero object; keep card art highly legible and culturally recognizable.
- Build dedicated states for 패 distribution, 먹기/쓸, 고/스톱 decisions, 피박/광박/고박 and final score moments.
- Suggested signature motion: card fan-out, fast table snap, captured-card stack movement, gold/red score burst.
- Required UI assets: game tile, table mat, card front/back set, score board, captured-card zones, GO/STOP controls, turn marker, result banners, tutorial/rules panel.

## 섯다 visual direction

- Darker, more private high-stakes room than 맞고: black lacquer + deep red + gold.
- Korean hwatu-derived seotda cards should be larger and more dramatic than ordinary playing cards.
- Signature moments: card peek/reveal, two-card slam, betting-chip push, hand-rank reveal, all-in tension state.
- Required UI assets: game tile, table mat, card set, chip/bet controls, call/raise/fold/check/all-in states as rules require, hand-rank badge set, showdown animation, result banners, history/ledger strip.

## Implementation constraints

1. Asset-board images are references, not production-ready sprite sheets.
2. Production assets should be recreated/cut as optimized SVG/WebP/PNG under `public/assets/`.
3. Avoid embedding text into production art when the copy needs localization or dynamic values.
4. Preserve touch target size and safe-area behavior for landscape phones.
5. Use motion to reinforce game state, never to obscure bankroll, stake, current bet, turn, or result.
6. Social-casino presentation must not imply cash-out or real-money redemption if the game economy is virtual-only.

## Next asset packs

Priority order:
1. 맞고 full asset pack
2. 섯다 full asset pack
3. Texas Hold'em full asset pack
4. Slots / jackpot machine pack
5. Shared Korean-room lobby / table-selection pack
6. Tournament, leaderboard, profile and social expansion pack
