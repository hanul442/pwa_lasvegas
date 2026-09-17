# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-02 — Game-Mode Navigation & Scroll Hardening
- Objective: Harden full-screen game/table navigation and scrolling across mobile portrait, short landscape and desktop before adding more presentation work.
- User-visible outcome: Entering and leaving Games → Stake Tier → Table remains predictable with Back/Escape/browser Back, while vertical scrolling and controls stay reachable in constrained viewports.
- Acceptance criteria: Preserve existing Vegas visual language and motion; Back/Escape/browser Back restore the correct surface/focus; game-mode does not trap vertical scrolling; portrait, short-landscape and desktop CSS keep controls reachable; decorative motion remains non-intercepting and reduced-motion safe; preserve virtual-only CH semantics; no database/secrets changes; validate before merge.
- Current phase: TEST
- Completed checkpoints:
  - VEGAS-MOTION-02 DEPLOY/VERIFY/DONE: production was healthy on main with #50 included.
  - DISCOVER: audited public/styles.css, public/index.html and public/app.js. Existing game-mode hides bottom nav correctly and navigation/focus restoration is intact, but constrained landscape forced a 220px table minimum while game-mode lacked an explicit vertical-scroll/touch-pan contract.
  - PLAN/IMPLEMENT: added post-base public/usability.css. Game mode explicitly permits vertical/momentum scrolling; table stage uses touch-action:pan-y; safe-area bottom reachability is retained; short landscape table minimum uses clamp(180px,54dvh,220px). No game/economy/backend/database behavior changed.
  - TEST PREP: added tests/game-mode-scroll-hardening.test.mjs guarding stylesheet load order, vertical scrolling, safe-area reachability, pan-y and short-landscape sizing.
  - PR: opened #51 from automation/vegas-usability-02-scroll-hardening. Initial exact-head workflow lookup returned no run yet; mergeability initially false while GitHub computes state.
- Next checkpoint: Check PR #51 exact-head CI and mergeability; if green/scoped, squash merge.
- Blockers: Browser visual E2E unavailable. Railway production has one unrelated staged environment change; do not accept it automatically.
- Relevant PR/branch: PR #51; automation/vegas-usability-02-scroll-hardening; current state commit follows implementation head 741fba155bf9150c036f5a39d61dada32e175896.
- Validation status: Targeted regression authored; exact-head CI pending.
- Deploy status: Existing production remains healthy; no deployment for this sprint yet.
- Next action: Check PR #51 exact-head CI + mergeability, review scoped diff, then squash merge only when green.
