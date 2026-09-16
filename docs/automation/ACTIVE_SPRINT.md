# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-02 — Game-Mode Navigation & Scroll Hardening
- Objective: Harden full-screen game/table navigation and scrolling across mobile portrait, short landscape and desktop before adding more presentation work.
- User-visible outcome: Entering and leaving Games → Stake Tier → Table remains predictable with Back/Escape/browser Back, while vertical scrolling and controls stay reachable in constrained viewports.
- Acceptance criteria: Preserve existing Vegas visual language and motion; Back/Escape/browser Back restore the correct surface/focus; game-mode does not trap vertical scrolling; portrait, short-landscape and desktop CSS keep controls reachable; decorative motion remains non-intercepting and reduced-motion safe; preserve virtual-only CH semantics; no database/secrets changes; validate before merge.
- Current phase: DISCOVER
- Completed checkpoints:
  - VEGAS-MOTION-02 DEPLOY/VERIFY/DONE: Railway production deployment 5e30c4a8-b3e3-41c0-a91a-9332993ecfe7 is SUCCESS on main revision 5368047361bdf984c029b62e4f6b9714958f3879, which contains merge revision 24410263a45e949ba6f2f6378d4b5b7110a69e01. Build healthcheck /api/health passed 1/1; runtime reports Supabase persistence ready and server listening on :8080. Static regression confirms ambience is aria-hidden/pointer-events:none, copy/motion stacking is protected, short-landscape and reduced-motion fallbacks exist. app.js preserves Back/Escape/browser-popstate paths and focus restoration. Browser visual E2E remains unavailable, so verification is code/regression/runtime-health based.
- Next checkpoint: Inspect game-mode/tier/table CSS overflow, min-height, fixed/sticky controls and short-landscape rules; identify any scroll/reachability trap and implement one coherent hardening slice with targeted regression.
- Blockers: Browser visual E2E unavailable. Railway production has one unrelated staged environment change; do not accept it automatically.
- Relevant PR/branch: main; previous PR #50 MERGED as 24410263a45e949ba6f2f6378d4b5b7110a69e01. No PR yet for VEGAS-USABILITY-02.
- Validation status: Previous sprint CI #165 GREEN; production deployment SUCCESS; /api/health 1/1; runtime healthy. New sprint discovery pending.
- Deploy status: Production healthy on main revision 5368047361bdf984c029b62e4f6b9714958f3879. Unrelated staged Railway change left untouched.
- Next action: Audit game-mode/tier/table responsive overflow and reachability, then implement and regression-test the highest-value safe usability fix.
