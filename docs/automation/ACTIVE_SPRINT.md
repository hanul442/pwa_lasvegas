# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-02 — Game-Mode Navigation & Scroll Hardening
- Objective: Harden full-screen game/table navigation and scrolling across mobile portrait, short landscape and desktop before adding more presentation work.
- User-visible outcome: Entering and leaving Games → Stake Tier → Table remains predictable with Back/Escape/browser Back, while vertical scrolling and controls stay reachable in constrained viewports.
- Acceptance criteria: Preserve existing Vegas visual language and motion; Back/Escape/browser Back restore the correct surface/focus; game-mode does not trap vertical scrolling; portrait, short-landscape and desktop CSS keep controls reachable; decorative motion remains non-intercepting and reduced-motion safe; preserve virtual-only CH semantics; no database/secrets changes; validate before merge.
- Current phase: DEPLOY
- Completed checkpoints:
  - VEGAS-MOTION-02 DEPLOY/VERIFY/DONE: production was healthy on main with #50 included.
  - DISCOVER: audited public/styles.css, public/index.html and public/app.js. Existing game-mode hides bottom nav correctly and navigation/focus restoration is intact, but constrained landscape forced a 220px table minimum while game-mode lacked an explicit vertical-scroll/touch-pan contract.
  - PLAN/IMPLEMENT: added post-base public/usability.css. Game mode explicitly permits vertical/momentum scrolling; table stage uses touch-action:pan-y; safe-area bottom reachability is retained; short landscape table minimum uses clamp(180px,54dvh,220px). No game/economy/backend/database behavior changed.
  - TEST: targeted regression added; PR #51 exact-head 8ec350229d9d7ad39e0efd73fc6c7015ca2b3005 passed CI #170; GitHub reported mergeable=true.
  - REVIEW: scoped diff reviewed: only docs/automation/ACTIVE_SPRINT.md, public/index.html, public/usability.css and tests/game-mode-scroll-hardening.test.mjs changed; no backend/economy/database/secrets changes.
  - MERGE: PR #51 squash-merged to main as f5b7b0e215aafd469abacb8445f9e40cdf37152f.
- Next checkpoint: Wait for Railway deployment f95dd2c8-c71e-4839-91b1-30427a19fb68 of exact merge revision f5b7b0e215aafd469abacb8445f9e40cdf37152f to finish; if SUCCESS, inspect build/runtime health and verify scroll/navigation invariants.
- Blockers: Browser visual E2E unavailable. Railway production has one unrelated staged environment change; do not accept it automatically.
- Relevant PR/branch: PR #51 MERGED; main; merge revision f5b7b0e215aafd469abacb8445f9e40cdf37152f.
- Validation status: CI #170 GREEN; scoped review passed. Production verification pending.
- Deploy status: Railway deployment f95dd2c8-c71e-4839-91b1-30427a19fb68 is BUILDING for exact merge revision f5b7b0e215aafd469abacb8445f9e40cdf37152f.
- Next action: Confirm Railway SUCCESS, inspect /api/health/runtime, verify portrait/short-landscape/desktop scroll and Back/Escape invariants using available regression/runtime evidence, then mark VEGAS-USABILITY-02 DONE if green.
