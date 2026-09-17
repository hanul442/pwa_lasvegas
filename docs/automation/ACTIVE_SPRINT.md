# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-03 — Gesture, Obscured-Content & Responsive Control Audit
- Objective: Continue highest-priority usability hardening by eliminating gesture conflicts, obscured interactive content, and control reachability regressions across game/table flows before adding further presentation work.
- User-visible outcome: Games → Stake Tier → Table remains comfortably usable by touch and pointer in mobile portrait, short landscape and desktop, including notched landscape devices, with controls visible/reachable and vertical scrolling preserved.
- Acceptance criteria: Audit drag/touch-action/overscroll/fixed-sticky/z-index/safe-area interactions; no decorative layer intercepts input; no primary game/table control is obscured in portrait or short landscape; preserve Back/Escape/browser Back and focus restoration; preserve existing Vegas visual language/motion and reduced-motion safety; preserve virtual-only CH semantics; no database/secrets changes; validate before merge.
- Current phase: TEST
- Completed checkpoints:
  - VEGAS-USABILITY-02 TEST/REVIEW/MERGE/DEPLOY/VERIFY/DONE: PR #51 passed CI #170, merged as f5b7b0e2, and production validation was GREEN on Railway main revision 333a7f1a.
  - VEGAS-USABILITY-03 DISCOVER: audited public styles/app markup. No custom pointer/drag handlers exist in the current shell; table ambience/motion are decorative. Identified the concrete remaining reachability risk as horizontal safe-area omission on notched landscape devices plus an underspecified 44px Back touch target/gesture contract.
  - VEGAS-USABILITY-03 PLAN/IMPLEMENT: added game-mode left/right safe-area padding to topbar/surface content, horizontal overscroll containment, explicit 44px Back target, tier manipulation contract, table vertical-pan contract, and defensive pointer-events:none for decorative table layers. Added targeted regression tests in tests/game-mode-gesture-safe-area.test.mjs.
  - PR #52 opened from automation/vegas-usability-03. Initial head 6ffae68a had no workflow run yet and GitHub mergeability was still computing/false immediately after creation.
- Next checkpoint: Wait for exact-head CI on PR #52, then confirm mergeability and scoped diff. If GREEN, squash merge, deploy, and verify production affected flows.
- Blockers: Browser visual E2E unavailable. Railway production has one unrelated staged environment change; do not accept it automatically.
- Relevant PR/branch: PR #52; automation/vegas-usability-03.
- Validation status: Targeted regression authored; exact-head CI pending. Prior production baseline GREEN.
- Deploy status: Production remains on prior healthy main baseline; no VEGAS-USABILITY-03 deploy yet.
- Next action: PR #52 exact-head CI + scoped REVIEW; GREEN → squash MERGE → Railway deploy/health → portrait/short-landscape/notched-landscape gesture/reachability and Back/Escape invariants VERIFY.
