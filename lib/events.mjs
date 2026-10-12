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
  }
];

export const eventById = id => EVENTS.find(e => e.id === id) || null;
export const eventOpen = (event, now = Date.now()) => Boolean(event) && now >= Date.parse(event.from) && now < Date.parse(event.until);
export const liveEvents = (now = Date.now()) => EVENTS.filter(e => eventOpen(e, now)).map(e => ({ ...e, rules: [...e.rules] }));
