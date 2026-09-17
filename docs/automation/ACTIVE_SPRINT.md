# ACTIVE SPRINT

- Sprint ID/title: VEGAS-MOTION-03 — Poker Card Spread & Table Feedback
- Objective: Complete the approved game-specific Vegas motion language by adding a polished poker card-spread/table-entry treatment without regressing completed usability hardening.
- User-visible outcome: Entering a Poker table produces a responsive five-card fan/spread consistent with the existing Blackjack/Roulette/Dice presentation while controls, scrolling, focus and reduced-motion behavior remain clear.
- Acceptance criteria: Distinct Poker spread; decorative/input-transparent; reduced-motion static fallback; compact short-landscape geometry; portrait/landscape/desktop reachability preserved; Back/Escape/browser-Back and virtual-only CH semantics unchanged.
- Current phase: TEST
- Completed checkpoints:
  - DISCOVER: Poker was the only current table without game-specific motion.
  - PLAN: use the existing `.table-motion` layer; five-card fan, staggered 0.64s entry, no JS/game/economy changes; compact short-landscape geometry and static reduced-motion fallback.
  - IMPLEMENT: added `.motion-poker` markup and isolated `public/poker-motion.css`; layer is pointer-transparent and only displays for `data-game=poker`.
  - IMPLEMENT responsive: five-card geometry contracts from 68x96 portrait/desktop cards to 50x70 short-landscape cards.
  - IMPLEMENT accessibility: `prefers-reduced-motion` disables poker entry animation while preserving a legible static spread.
  - TEST authored: `tests/poker-motion.test.mjs` guards five-card markup, Poker-only activation, pointer transparency, entry animation, reduced-motion fallback and short-landscape geometry.
- Next checkpoint: exact-head CI for branch → REVIEW scoped diff/mergeability → merge when GREEN.
- Blockers: Browser visual E2E unavailable. Leave unrelated Railway staged environment change untouched.
- Relevant PR/branch: `automation/vegas-motion-03-poker-spread`; PR pending creation.
- Validation status: targeted regression committed; CI not yet observed.
- Deploy status: Existing production remains healthy on previously verified Railway deployment; this branch is not deployed.
- Next action: open PR, observe exact-head CI, review diff/mergeability, then squash merge if GREEN.
