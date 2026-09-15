# VEGAS Design Reference

This directory stores approved visual direction references for the VEGAS PWA. These are implementation references, not production UI assets and not instructions to copy any third-party casino product literally.

## Reference boards

- `vegas-desktop-lobby-concept.jpg` — desktop lobby + gameplay visual direction. Use for information hierarchy, black/gold material system, table-card density, VIP treatment, and cinematic casino ambience.
- `vegas-mobile-landscape-concept.jpg` — approved mobile landscape direction. Treat this as the primary responsive target for landscape phones: large brand masthead, game-first navigation, hero area, horizontal game cards, daily challenge/VIP modules, and touch-friendly controls.

## Brand anchor

Production logo: `/public/assets/vegas-logo.svg`

Core direction: deep black / graphite surfaces, warm metallic gold, controlled glow, premium casino-floor ambience, strong game imagery, subtle emerald felt/red accent colors, and animation-led feedback without sacrificing legibility.

## Interaction principles

1. Mobile landscape is a first-class layout, not a shrunk desktop view.
2. Lobby -> game entry should be visually obvious in one tap.
3. Blackjack cards deal, roulette wheel spins, dice throw, chips move, and win/loss moments receive purposeful animation.
4. Keep bankroll, stake tier, current bet, session result, and exit/back controls continuously understandable.
5. Prefer cinematic depth and physical casino cues over generic dashboard cards.
6. Preserve vertical/horizontal scrolling and safe-area behavior on mobile.

## Implementation note

The checked-in JPGs are lightweight repository references. Higher-resolution source concepts can be regenerated from the approved direction when needed; production artwork should live under `public/assets/` only after optimization and licensing/ownership review.
