# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-04 — Keyboard Focus & Navigation Resilience
- Objective: Harden focus visibility and keyboard/navigation continuity across Games → Stake Tier → Table without regressing touch, scrolling or Vegas presentation.
- User-visible outcome: Back and primary game/tier/table controls remain visibly focusable and navigation state remains understandable after keyboard, Escape and browser-Back transitions on mobile/desktop-capable browsers.
- Acceptance criteria: Visible `:focus-visible` treatment for primary interactive controls; no focus ring clipping/obscuring; Back/Escape/browser Back and focus restoration preserved; portrait/short/notched landscape scrolling and gesture contracts preserved; decorative layers remain input-transparent; existing Vegas visual language and virtual-only CH semantics preserved.
- Current phase: DEPLOY
- Completed checkpoints:
  - DISCOVER: audited `public/app.js`, `public/styles.css` and `public/usability.css`; primary controls lacked an explicit `:focus-visible` contract while Escape/browser-Back trigger restoration already existed.
  - PLAN: selected a CSS-first low-risk focus slice with strong gold focus-visible treatment, stacking protection for focused game-mode controls, and semantic programmatic heading focus.
  - IMPLEMENT: added the focus contract to `public/usability.css` without changing touch-action, scrolling, safe-area, motion or virtual-CH behavior.
  - TEST: added `tests/keyboard-focus-resilience.test.mjs` covering focus-visible styling, heading focus semantics and Escape/popstate trigger restoration hooks.
  - REVIEW: PR #53 exact head `f87687aec99b8f53defb74c0ca23d8ccb1cbebe9` had CI run #179 SUCCESS, mergeable=true; scoped diff limited to sprint state, usability CSS and targeted regression.
  - MERGE: PR #53 squash merged to main as `f24a4ca0b965c1747bf30f4a0bd2106be73bae89`.
- Next checkpoint: Verify Railway deployment containing merge `f24a4ca0`, confirm runtime `/api/health`, then verify keyboard focus + Escape/browser-Back affected-flow invariants and mark DONE if green.
- Blockers: Browser visual E2E unavailable. Leave unrelated Railway staged environment change untouched.
- Relevant PR/branch: PR #53 MERGED; main merge revision `f24a4ca0b965c1747bf30f4a0bd2106be73bae89`.
- Validation status: Exact-head CI #179 GREEN; scoped REVIEW GREEN; merge completed.
- Deploy status: Awaiting Railway production deployment/verification for merged main.
- Next action: Railway exact-revision deployment check → runtime health → keyboard focus + Escape/browser-Back VERIFY → DONE.
