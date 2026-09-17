# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-03 — Gesture, Obscured-Content & Responsive Control Audit
- Objective: Continue highest-priority usability hardening by eliminating gesture conflicts, obscured interactive content, and control reachability regressions across game/table flows before adding further presentation work.
- User-visible outcome: Games → Stake Tier → Table remains comfortably usable by touch and pointer in mobile portrait, short landscape and desktop, with controls visible/reachable and vertical scrolling preserved.
- Acceptance criteria: Audit drag/touch-action/overscroll/fixed-sticky/z-index/safe-area interactions; no decorative layer intercepts input; no primary game/table control is obscured in portrait or short landscape; preserve Back/Escape/browser Back and focus restoration; preserve existing Vegas visual language/motion and reduced-motion safety; preserve virtual-only CH semantics; no database/secrets changes; validate before merge.
- Current phase: DISCOVER
- Completed checkpoints:
  - VEGAS-USABILITY-02 TEST/REVIEW/MERGE: PR #51 exact-head 8ec350229d9d7ad39e0efd73fc6c7015ca2b3005 passed CI #170 and was squash-merged as f5b7b0e215aafd469abacb8445f9e40cdf37152f.
  - VEGAS-USABILITY-02 DEPLOY/VERIFY/DONE: exact merge deployment f95dd2c8 was superseded/removed by the scheduler-state main commit, and Railway deployment 0c37f032-7fab-42fe-8134-2b0850146ac6 for main 333a7f1addcf131e4a8300c0c8926e97fb1f1a5c completed SUCCESS. Build healthcheck /api/health passed 1/1; runtime reported Supabase persistence ready (users=4) and listening on 0.0.0.0:8080. Because 333a7f1a descends from f5b7b0e2, the deployed revision contains the scroll hardening. Existing targeted regression evidence covers vertical pan/short-landscape reachability and navigation invariants; browser visual E2E remains unavailable.
  - VEGAS-USABILITY-03 DISCOVER initialized from approved product priority after VEGAS-USABILITY-02 completed green.
- Next checkpoint: Audit current public CSS/JS for touch-action, pointer/drag handlers, overscroll, fixed/sticky layers, z-index and safe-area interactions in Games → Stake Tier → Table; identify one concrete high-value gesture/obscured-content failure and define a coherent hardening slice.
- Blockers: Browser visual E2E unavailable. Railway production has one unrelated staged environment change; do not accept it automatically.
- Relevant PR/branch: main. No PR yet for VEGAS-USABILITY-03.
- Validation status: VEGAS-USABILITY-02 production GREEN: CI #170 GREEN; Railway 0c37f032 SUCCESS; /api/health 1/1; Supabase persistence ready; server :8080. VEGAS-USABILITY-03 validation not started.
- Deploy status: Production healthy on Railway deployment 0c37f032-7fab-42fe-8134-2b0850146ac6, main revision 333a7f1addcf131e4a8300c0c8926e97fb1f1a5c, containing #51 merge f5b7b0e2.
- Next action: Perform the scoped gesture/obscured-content audit, then implement one substantial low-risk hardening slice with targeted regression coverage; do not touch economy/backend/database/secrets.
