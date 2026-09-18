# ACTIVE SPRINT

- Sprint ID/title: VEGAS-PLAY-01 — Blackjack End-to-End Integration
- Objective: Connect the approved clean UI shell to the existing server-authoritative Blackjack V2/economy path and establish the canonical live-table integration pattern.
- Acceptance criteria: Lobby/Games → Stake Tier → Blackjack Table reaches real server session; cards/dealer/HIT/STAND/DOUBLE/settlement render authoritative responses; wallet refreshes from backend; idempotency preserved; Back/Escape/browser-Back and responsive/reduced-motion reachability preserved; virtual-only/no cash-out semantics; targeted regression + deployed exact-SHA smoke validation green.
- Current phase: REVIEW
- Completed checkpoints:
  - VEGAS-MOTION-04 CLOSED at minimum coherent/non-blocking level: existing clean-shell entry cue retained; no further decorative motion roadmap work added.
  - DISCOVER: confirmed clean shell was placeholder-only while server already exposes `/api/blackjack/v2/open`, `/start`, `/action` with lock/settlement and idempotency semantics.
  - PLAN: selected a thin client adapter over the existing V2 API; non-Blackjack tables explicitly remain integration-pending rather than pretending live state.
  - IMPLEMENT: Blackjack tier entry now opens/resumes an authoritative V2 round, renders player/dealer cards and values, sends HIT/STAND/DOUBLE with unique idempotency keys, renders settlement, and refreshes visible virtual CH wallet from response state.
  - IMPLEMENT: responsive live-table controls added for portrait/short-landscape/desktop; reduced-motion remains static; Back/Escape/browser history code retained.
- Next checkpoint: REVIEW exact response-shape compatibility against Blackjack V2 public model, add/adjust targeted clean-shell integration regression tests, run checks, then merge/deploy only if green.
- Blockers: Browser visual E2E unavailable. Production identity still uses the server's preview `x-player-id`/default actor trust path and must be hardened independently before production-grade identity acceptance. Leave unrelated Railway staged environment change untouched.
- Relevant PR/branch: `automation/vegas-play-01-blackjack-shell` (PR pending at this checkpoint).
- Validation status: Implementation complete on branch; automated tests and deployed runtime smoke not yet executed in this slice. Existing server idempotency/economy code is reused rather than bypassed.
- Deploy exact SHA/status: not deployed; branch head `ed965a791174a556dc958c3945ebe60507354815` before this state-doc commit. Production remains on previously verified `955d8a0a5d9f124be4bc7e4219754ca36500b157`.
- Supabase/security/persistence impact: no schema/RPC/persistence mutation in this slice. `private.runtime_state` compatibility bridge unchanged. Identity/security remains an open P0 parallel track; no secrets added to client.
- Rollback path: do not merge the branch; if merged later, revert the VEGAS-PLAY-01 merge commit. Server APIs and persistence schema are unchanged by this slice.
- Next action: validate Blackjack V2 response shape + targeted tests on the PR, then MERGE → DEPLOY → exact-SHA `/api/health` + `/api/version` + live Blackjack smoke verification; in parallel begin smallest safe authenticated identity path.
