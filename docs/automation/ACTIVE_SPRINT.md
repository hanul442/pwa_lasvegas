# ACTIVE SPRINT

- Sprint ID/title: VEGAS-MOTION-04 — Table Entry Transitions & Responsive Feedback
- Objective: Continue the approved Vegas presentation by polishing table-entry transitions and immediate responsive feedback across games without regressing completed usability hardening.
- User-visible outcome: Entering Blackjack, Poker, Roulette or Dice feels like a coherent casino-floor-to-table transition, while controls remain immediately usable and motion stays responsive across portrait, short landscape and desktop.
- Acceptance criteria: Coherent table-entry transition shared across current games; decorative/input-transparent; no input blocking; reduced-motion fallback; short-landscape safe; portrait/landscape/desktop reachability preserved; existing game-specific deal/spread/spin/throw motion retained; Back/Escape/browser-Back and virtual-only CH semantics unchanged.
- Current phase: DISCOVER
- Completed checkpoints:
  - VEGAS-MOTION-03 VERIFIED/DONE: PR #54 merged as `955d8a0a5d9f124be4bc7e4219754ca36500b157`.
  - VEGAS-MOTION-03 DEPLOY: Railway deployment `c9d6dec9-ceca-4048-91b1-f46cb2cd25f9` SUCCESS for exact merge revision.
  - VEGAS-MOTION-03 runtime: Supabase persistence ready and SOCIAL VEGAS listening on `0.0.0.0:8080`; no startup regression observed.
  - VEGAS-MOTION-03 invariants: Poker five-card motion remains decorative/input-transparent, compact in short landscape and static under reduced motion by targeted regression/merged implementation.
  - VEGAS-MOTION-04 initialized as the next highest-value approved presentation slice after game-specific motion coverage.
- Next checkpoint: audit existing floor → game → tier → table transition classes/markup and current table feedback timing; identify one coherent non-blocking transition gap.
- Blockers: Browser visual E2E unavailable. Leave unrelated Railway staged environment change untouched.
- Relevant PR/branch: none yet; main at/after `955d8a0a5d9f124be4bc7e4219754ca36500b157`.
- Validation status: Previous sprint exact revision deployed healthy; new sprint discovery pending.
- Deploy status: Production healthy on Railway deployment `c9d6dec9-ceca-4048-91b1-f46cb2cd25f9` with commit `955d8a0a5d9f124be4bc7e4219754ca36500b157`.
- Next action: inspect existing table-entry/navigation presentation and motion CSS/markup, select the highest-value transition/feedback gap, then PLAN a coherent implementation slice with reduced-motion and responsive constraints.
