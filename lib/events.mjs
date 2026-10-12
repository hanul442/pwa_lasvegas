// Event tables: limited-time tables that put special rules and a theme over an existing game.
// Each event is one entry here: when it runs, which game it sits on, how it looks in the lobby,
// and what it is called. The game's own driver reads `rules` (lib/holdem-session.mjs ROYALE for
// Casino Royale). Adding an event: add an entry, then teach the game what its rules mean.
export const EVENTS = [
  {
    id: 'royale', title: 'Casino Royale', kicker: '007 체험 이벤트', game: 'poker',
    blurb: '턱시도를 입고 하이롤러 다섯 명과 홀덤 토너먼트. 마지막까지 남은 한 사람이 판돈을 전부 가져가요.',
    rules: ['바이인은 층의 최대 베팅', '6인 토너먼트 · 6핸드마다 블라인드 상승', '리바이 1회', '우승하면 바이인 ×6'],
    from: '2026-10-12T00:00:00+09:00', until: '2026-11-09T00:00:00+09:00'
  },
  {
    id: 'tazza', title: '타짜 나이트', kicker: '고스톱 이벤트', game: 'gostop',
    blurb: '꾼들이 모이는 밤. 아귀와 고광렬이 앉고, 모든 판이 처음부터 묻고 더블 ×2로 시작해요.',
    rules: ['모든 판 점수 ×2로 시작', '나가리가 나면 ×4, ×8까지', '상대는 아귀 · 고광렬'],
    from: '2026-10-12T00:00:00+09:00', until: '2026-11-09T00:00:00+09:00'
  },
  {
    id: 'oceans', title: "Ocean's Heist", kicker: '블랙잭 이벤트', game: 'blackjack',
    blurb: '대니의 크루와 같은 테이블에 앉아요. 다섯 판 연속으로 이기면 금고가 열려요.',
    rules: ['크루: 대니 · 러스티 · 라이너스', '5연승마다 금고 보너스 = 최소 베팅 ×10', '지면 연승이 처음부터'],
    streak: { need: 5, pays: 10, label: '금고' },
    from: '2026-10-12T00:00:00+09:00', until: '2026-11-09T00:00:00+09:00'
  },
  {
    id: 'rounders', title: 'Rounders', kicker: '홀덤 헤즈업 이벤트', game: 'poker',
    blurb: '1대1 보스전. 보스의 칩을 다 따면 다음 보스로 올라가요. 마지막은 KGB 테디.',
    rules: ['바이인은 층의 최대 베팅', '8핸드마다 블라인드 상승', '보스를 이기면 현상금 = 최소 베팅 × 단계'],
    from: '2026-10-12T00:00:00+09:00', until: '2026-11-09T00:00:00+09:00'
  },
  {
    id: 'montecarlo', title: 'Monte Carlo Gala', kicker: '바카라 이벤트', game: 'baccarat',
    blurb: '몬테카를로의 갈라 나이트. 세 판 연속으로 이기면 갈라 보너스가 나와요.',
    rules: ['3연승마다 갈라 보너스 = 최소 베팅 ×3', '지면 연승이 처음부터'],
    streak: { need: 3, pays: 3, label: '갈라' },
    from: '2026-10-12T00:00:00+09:00', until: '2026-11-09T00:00:00+09:00'
  }
];

export const eventById = id => EVENTS.find(e => e.id === id) || null;
export const eventOpen = (event, now = Date.now()) => Boolean(event) && now >= Date.parse(event.from) && now < Date.parse(event.until);
export const liveEvents = (now = Date.now()) => EVENTS.filter(e => eventOpen(e, now)).map(e => ({ ...e, rules: [...e.rules], ...(e.streak ? { streak: { ...e.streak } } : {}) }));
