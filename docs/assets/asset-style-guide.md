# VEGAS Asset Style Guide

## Art Direction
VEGAS는 어두운 프리미엄 카지노 플로어를 기본으로 한다.

### Core palette
- near-black / charcoal
- warm antique gold
- deep felt green
- restrained burgundy/red
- ivory for physical cards/chips when needed

현재 UI의 기준 색상은 `#080706`, `#e0bf70`, deep green 계열이다.

## Visual Character
- premium, cinematic, restrained
- tactile table materials
- soft directional light + controlled specular highlights
- high contrast focal object, quiet background
- 과도한 neon/cyberpunk/cheap casino 광고 느낌 금지
- 장식보다 게임의 물성(카드, 칩, 휠, 펠트, 주사위)을 우선

## Production Rules
### Background / hero
- default 16:9
- 중요한 피사체는 중앙 60% safe zone 안쪽
- 모바일 세로 crop에서도 핵심이 남아야 함
- 텍스트를 이미지에 삽입하지 않음

### Game card art
- 16:9 또는 4:3 원본
- UI가 위에 텍스트를 얹을 수 있도록 한쪽에 negative space 확보
- 단일 게임을 즉시 인지할 수 있는 대표 오브젝트 1~3개

### Isolated objects / icons
- transparent background 우선
- 동일 세트는 카메라 각도, 광원 방향, 재질 표현을 통일
- QA reference preview는 흰 배경 사용 가능

### Marketing
- production UI asset과 분리
- 브랜딩 문구는 후처리 레이어에서 처리

## Module cues
- Lobby: black/gold, invitation, depth, table lights
- Blackjack: green felt, ivory cards, gold/black chips
- Roulette: burgundy/black wheel + gold metal accents
- Dice: dark felt/leather, ivory dice, restrained red accents
- Poker: green/black felt, stacked chips, subtle card fan

## Negative prompts / reject cues
- readable fake text
- watermark
- brand logo
- slot-machine overload
- neon cyberpunk palette
- plastic toy look
- malformed cards/dice
- impossible suit symbols
- duplicated chips/cards caused by generation artifacts

## Integration
이미지는 UI hierarchy를 대체하지 않고 보조한다. 대비가 너무 강해 제목/버튼 가독성을 해치면 REVISE한다.
