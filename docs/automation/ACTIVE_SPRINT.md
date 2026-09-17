# ACTIVE SPRINT

- Sprint ID/title: VEGAS-USABILITY-04 — Keyboard Focus & Navigation Resilience
- Objective: Harden focus visibility and keyboard/navigation continuity across Games → Stake Tier → Table without regressing touch, scrolling or Vegas presentation.
- User-visible outcome: Back and primary game/tier/table controls remain visibly focusable and navigation state remains understandable after keyboard, Escape and browser-Back transitions on mobile/desktop-capable browsers.
- Acceptance criteria: Visible `:focus-visible` treatment for primary interactive controls; no focus ring clipping/obscuring; Back/Escape/browser Back and focus restoration preserved; portrait/short/notched landscape scrolling and gesture contracts preserved; decorative layers remain input-transparent; existing Vegas visual language and virtual-only CH semantics preserved.
- Current phase: TEST
- Completed checkpoints:
  - DISCOVER: audited `public/app.js`, `public/styles.css` and `public/usability.css`. Existing navigation already focuses active surface headings and restores the originating game trigger after Escape/browser Back, but primary controls had no explicit `:focus-visible` contract, making keyboard location difficult to perceive against the dark/gold Vegas UI.
  - PLAN: selected a CSS-first, low-risk focus slice: strong gold focus-visible ring for brand/nav/game/floor/tier/back controls, raised focused game-mode controls above nearby layers, and suppress decorative outline only on programmatically focused headings.
  - IMPLEMENT: added the focus contract to `public/usability.css` without changing touch-action, scrolling, safe-area, motion or virtual-CH behavior.
  - TEST: added `tests/keyboard-focus-resilience.test.mjs` covering focus-visible styling, heading focus semantics and existing Escape/popstate trigger restoration hooks.
- Next checkpoint: Run exact-head CI for the branch; if green, review scoped diff/mergeability, then squash merge.
- Blockers: Browser visual E2E unavailable. Leave unrelated Railway staged environment change untouched.
- Relevant PR/branch: `automation/vegas-usability-04-focus`; PR creation next after state update.
- Validation status: Targeted regression authored; exact-head CI pending.
- Deploy status: Production remains healthy on prior revision 906c5b97cc0d2cecce12519361fd13b973ca552a; no deployment for this sprint yet.
- Next action: Create PR → exact-head CI → scoped REVIEW/mergeability → GREEN squash MERGE → Railway DEPLOY/VERIFY.
