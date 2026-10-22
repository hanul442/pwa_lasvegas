# VEGAS Asset Factory

## Purpose
VEGAS용 시각 에셋을 3시간 주기로 2~4개씩 생산하는 지속형 파이프라인이다.

## Canonical Loop
BACKLOG → SELECT → PRECHECK → GENERATE → QA → REVISE/APPROVE → REGISTER → COMMIT → NEXT

## Source of Truth
- Backlog: `docs/assets/asset-backlog.json`
- Style guide: `docs/assets/asset-style-guide.md`
- Registry: `docs/assets/asset-registry.json`
- Run log: `docs/assets/asset-generation-log.md`
- Runtime assets: `public/assets/**`

## Selection
1. `status=backlog` 중 priority가 가장 높은 항목을 선택한다.
2. 한 run에서 2~4개만 처리한다.
3. 현재 UI에 실제 사용처가 있는 에셋을 우선한다.
4. 동일 역할의 APPROVED 에셋이 있으면 중복 생성하지 않는다.
5. style guide와 현재 코드의 레이아웃/색상/사용 위치를 확인한다.

## Generation
- 이미지 안에 UI 텍스트, 로고, 가격, 숫자, 버튼 문구를 직접 넣지 않는다.
- 프로덕션 에셋은 지정된 aspect ratio와 crop-safe zone을 지킨다.
- 독립 오브젝트는 투명 배경을 우선한다. QA/reference sheet가 필요하면 흰 배경 preview를 별도로 허용한다.
- 특정 상표/게임사의 고유 디자인을 복제하지 않는다.

## QA Gates
각 에셋은 아래를 PASS/REVISE/REJECT로 기록한다.
- visual consistency
- intended-use fit
- mobile crop safety
- text/logo contamination
- duplicate risk
- artifact/anatomy/perspective defects
- contrast against VEGAS UI
- file naming/path compliance

## Status
`backlog | selected | generated | revise | approved | rejected | committed | generated_pending_upload`

## GitHub
권장 경로:
- `public/assets/shared/backgrounds/`
- `public/assets/shared/textures/`
- `public/assets/shared/abstract/`
- `public/assets/shared/marketing/`
- `public/assets/lobby/`
- `public/assets/games/blackjack/`
- `public/assets/games/roulette/`
- `public/assets/games/dice/`
- `public/assets/games/poker/`
- 향후 게임은 `public/assets/games/<game>/`

파일명:
`veg-<module>-<role>-vNN.<ext>`

예:
`veg-lobby-hero-bg-v01.webp`

## Failure Rule
이미지 바이너리를 GitHub에 직접 올릴 수 없는 실행 환경에서는 업로드를 성공했다고 기록하지 않는다.
Registry에 `generated_pending_upload`로 남기고 생성 결과/파일 참조를 보고한다.

## Reporting
각 run 종료 시 다음만 요약한다.
- selected
- generated
- approved/revise/rejected
- committed/pending upload
- next queue
