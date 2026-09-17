# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-04 — Keyboard Focus & Navigation Resilience
- Objective: Harden focus visibility and keyboard/navigation continuity across Games → Stake Tier → Table without regressing touch, scrolling or Vegas presentation.
- User-visible outcome: Back and primary game/tier/table controls remain visibly focusable and navigation state remains understandable after keyboard, Escape and browser-Back transitions on mobile/desktop-capable browsers.
- Acceptance criteria: Visible `:focus-visible` treatment for primary interactive controls; no focus ring clipping/obscuring; Back/Escape/browser Back and focus restoration preserved; portrait/short/notched landscape scrolling and gesture contracts preserved; decorative layers remain input-transparent; existing Vegas visual language and virtual-only CH semantics preserved.
- Current phase: DISCOVER
- Completed checkpoints:
  - VEGAS-USABILITY-03 DEPLOY: Railway deployment b5fd6211-bb38-4abd-9fc8-66947a4956c4 SUCCESS at main 906c5b97cc0d2cecce12519361fd13b973ca552a, which contains PR #52 merge 8013e582747a7847b36dfdf32c56c42e747e6e11.
  - VEGAS-USABILITY-03 VERIFY: Railway healthcheck `/api/health` configured with 30s timeout; deployment passed Railway health gate; runtime logs show Supabase persistence ready (users=4) and server listening on 0.0.0.0:8080. Static invariants remain present in `public/usability.css`: safe-area padding, 44px Back target, tier manipulation, table pan-y, pointer-transparent ambience/motion and constrained-landscape sizing.
  - VEGAS-USABILITY-03 DONE: production/runtime and affected static interaction invariants green; browser visual E2E remains unavailable but is non-blocking for the validated slice.
- Next checkpoint: Audit existing focus-visible/focus restoration rules and active-surface navigation hooks; identify one concrete keyboard/focus failure and implement a coherent low-risk hardening slice with targeted regression coverage.
- Blockers: Browser visual E2E unavailable. Leave unrelated Railway staged environment change untouched.
- Relevant PR/branch: main; VEGAS-USABILITY-03 PR #52 MERGED. No PR yet for VEGAS-USABILITY-04.
- Validation status: Previous sprint production GREEN. New sprint discovery pending.
- Deploy status: Production healthy on Railway deployment b5fd6211-bb38-4abd-9fc8-66947a4956c4 / revision 906c5b97cc0d2cecce12519361fd13b973ca552a.
- Next action: Focus-visible CSS + navigation/focus-restoration hook audit → select concrete failure → PLAN/IMPLEMENT targeted hardening + regression.
