# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-03 — Gesture, Obscured-Content & Responsive Control Audit
- Objective: Eliminate gesture conflicts, obscured interactive content, and control reachability regressions across game/table flows.
- User-visible outcome: Games → Stake Tier → Table remains usable in mobile portrait, short/notched landscape and desktop, with controls reachable and vertical scrolling preserved.
- Acceptance criteria: Safe touch/scroll behavior; decorative layers do not intercept input; primary controls remain reachable; Back/Escape/browser Back and focus restoration preserved; existing Vegas visual language and virtual-only CH semantics preserved.
- Current phase: DEPLOY
- Completed checkpoints:
  - DISCOVER/PLAN/IMPLEMENT: identified notched-landscape safe-area and Back touch-target risk; implemented horizontal safe-area protection, overscroll containment, 44px Back target, tier/table gesture contracts and pointer-transparent decorative layers; added targeted regression coverage.
  - TEST: PR #52 exact head a8fed5e058880fe3b04da35a51c34e08d654db6b passed CI #175.
  - REVIEW: mergeable=true; scoped files limited to ACTIVE_SPRINT.md, public/usability.css and tests/game-mode-gesture-safe-area.test.mjs.
  - MERGE: PR #52 squash-merged as 8013e582747a7847b36dfdf32c56c42e747e6e11.
- Next checkpoint: Confirm Railway deployment containing 8013e582 is successful, then verify runtime health and affected gesture/reachability/navigation invariants.
- Blockers: Browser visual E2E unavailable. Leave unrelated Railway staged environment change untouched.
- Relevant PR/branch: PR #52 MERGED; main contains 8013e582747a7847b36dfdf32c56c42e747e6e11.
- Validation status: CI #175 GREEN; mergeability GREEN; scoped review complete; production verification pending.
- Deploy status: Awaiting confirmation of Railway main deployment containing 8013e582; prior production baseline healthy.
- Next action: Railway deployment status → runtime health → portrait/short-landscape/notched-landscape gesture/reachability plus Back/Escape VERIFY → DONE if green.
