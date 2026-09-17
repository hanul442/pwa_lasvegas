# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-02 — Game-Mode Navigation & Scroll Hardening
- Objective: Harden full-screen game/table navigation and scrolling across mobile portrait, short landscape and desktop before adding more presentation work.
- User-visible outcome: Entering and leaving Games → Stake Tier → Table remains predictable with Back/Escape/browser Back, while vertical scrolling and controls stay reachable in constrained viewports.
- Acceptance criteria: Preserve existing Vegas visual language and motion; Back/Escape/browser Back restore the correct surface/focus; game-mode does not trap vertical scrolling; portrait, short-landscape and desktop CSS keep controls reachable; decorative motion remains non-intercepting and reduced-motion safe; preserve virtual-only CH semantics; no database/secrets changes; validate before merge.
- Current phase: TEST
- Completed checkpoints:
  - VEGAS-MOTION-02 DEPLOY/VERIFY/DONE: Railway production deployment 5e30c4a8-b3e3-41c0-a91a-9332993ecfe7 is SUCCESS on main revision 5368047361bdf984c029b62e4f6b9714958f3879, which contains merge revision 24410263a45e949ba6f2f6378d4b5b7110a69e01.
  - DISCOVER: audited public/styles.css, public/index.html and public/app.js. Existing game-mode hides bottom nav correctly and navigation/focus restoration is intact, but constrained landscape still forces a 220px table minimum while game-mode lacks an explicit vertical-scroll/touch-pan contract.
  - PLAN/IMPLEMENT: added a narrow post-base usability stylesheet. Game mode explicitly permits vertical scrolling and momentum scrolling; table stage uses touch-action:pan-y; safe-area bottom reachability is retained; short landscape table minimum is responsive via clamp(180px,54dvh,220px) rather than always 220px. No game/economy/backend/database behavior changed.
  - TEST PREP: added tests/game-mode-scroll-hardening.test.mjs guarding stylesheet load order, vertical scrolling, safe-area reachability, pan-y and short-landscape responsive table sizing.
- Next checkpoint: Run exact-head CI for the usability branch; if green, review scoped diff/mergeability and squash merge.
- Blockers: Browser visual E2E unavailable. Railway production has one unrelated staged environment change; do not accept it automatically.
- Relevant PR/branch: automation/vegas-usability-02-scroll-hardening; PR pending creation.
- Validation status: Targeted regression authored; exact-head CI pending.
- Deploy status: Existing production remains healthy on main revision 5368047361bdf984c029b62e4f6b9714958f3879; no deployment for this sprint yet.
- Next action: Create PR, wait for exact-head CI, then review/merge only if green and scoped.
