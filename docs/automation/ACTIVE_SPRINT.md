# ACTIVE SPRINT

- Sprint ID/title: VEGAS-MOTION-03 — Poker Card Spread & Table Feedback
- Objective: Complete the approved game-specific Vegas motion language by adding a polished poker card-spread/table-entry treatment without regressing the usability hardening completed in VEGAS-USABILITY-02/03/04.
- User-visible outcome: Entering a Poker table produces an intentional, responsive poker-specific card spread consistent with Blackjack/Roulette/Dice presentation, while controls, scrolling, focus and reduced-motion behavior remain clear and usable.
- Acceptance criteria: Poker has a distinct card-spread entry treatment; animation is decorative/input-transparent and does not obscure actionable controls; reduced-motion fallback is static and legible; portrait, short/notched landscape and desktop layouts remain reachable; Back/Escape/browser-Back focus restoration remains preserved; virtual-only CH semantics remain unchanged.
- Current phase: DISCOVER
- Completed checkpoints:
  - VEGAS-USABILITY-04 VERIFY: Railway production deployment `f2ba95f4-b2c2-47a8-897a-1d7e2dc6ca4d` for main `a6ddf00fc5b23371793b4dbbb7ab417422690259` is SUCCESS; that revision contains PR #53 merge `f24a4ca0b965c1747bf30f4a0bd2106be73bae89`.
  - VEGAS-USABILITY-04 runtime: Railway healthcheck path remains `/api/health`; deployment started successfully with Supabase persistence ready (`users=4`) and server listening on `0.0.0.0:8080`.
  - VEGAS-USABILITY-04 affected-flow invariant review: deployed source preserves explicit `:focus-visible` treatment, focus stacking protection, semantic programmatic heading focus, Escape/browser-Back trigger restoration, safe-area/gesture rules and input-transparent decorative layers.
  - VEGAS-USABILITY-04 DONE.
  - DISCOVER: reviewed current table presentation. Blackjack has card-deal motion, Roulette wheel-spin and Dice throw, but Poker currently has no game-specific motion because `.table-motion` only contains cards/wheel/dice and CSS only activates those three game selectors.
- Next checkpoint: PLAN the smallest coherent Poker motion slice using the existing table-motion layer, then implement markup/CSS + reduced-motion and targeted regression without changing game/economy logic.
- Blockers: Browser visual E2E unavailable. Leave unrelated Railway staged environment change untouched.
- Relevant PR/branch: none yet; main contains completed PR #53 and production-verified state.
- Validation status: Previous sprint production GREEN. VEGAS-MOTION-03 discovery complete; implementation not started.
- Deploy status: Production healthy on Railway deployment `f2ba95f4-b2c2-47a8-897a-1d7e2dc6ca4d` (main `a6ddf00f`).
- Next action: PLAN Poker card-spread geometry/timing → IMPLEMENT in existing presentation layer → targeted regression → CI/REVIEW.
