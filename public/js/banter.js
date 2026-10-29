// AI regulars at the 화투 tables talk like people: a shout on 고, a sigh on 뻑, a dig when they
// steal your 피, a grumble when they lose. Each name is one character with its own way of
// talking, the same person at 맞고, 고스톱 and 섯다. Purely cosmetic and client-side: lines are
// picked from the events the server already sends and shown in a bubble by that AI's seat.
import { el, ms } from './fx.js';
import { hwatu } from './hwatu.js';

// trigger → lines. `{n}` is the 고 count. A persona without a trigger falls back to HOUSE.
const HOUSE = {
  hello: ['잘 부탁해요.', '자, 시작해 볼까요.'],
  think: ['어디 보자…', '음…'],
  go: ['고!', '고 갑니다.'], goMore: ['{n}고! 한 번 더.'],
  stop: ['스톱. 여기까지 할게요.'],
  ppeok: ['아, 뻑이네…', '에휴, 뻑.'],
  otherPpeok: ['뻑! 그거 제가 먹을게요.'],
  steal: ['피 한 장 주세요.'], robbed: ['아, 제 피…'],
  bomb: ['폭탄입니다!'], shake: ['흔들게요.'], nervous: ['흔들었어요? 무섭네.'],
  humanGo: ['고요? 배짱 좋네요.'], gwang: ['광 들어왔다.'],
  win: ['제가 이겼네요.', '감사합니다.'], lose: ['졌네요. 다음 판에 봐요.'], nagari: ['나가리네요. 다음 판 두 배!'],
  raise: ['올릴게요.'], call: ['받을게요.'], fold: ['다이.'], check: ['체크.'],
  bigHand: ['땡이에요!'], trash: ['망통이었네요.'], humanRaise: ['세게 나오시네요.'], redeal: ['다시 해요.']
};

export const PERSONAS = {
  // 큰손 사장님: 허세, 호탕, 지는 건 절대 인정 안 함.
  '박사장': {
    hello: ['자, 한판 하자고.', '오늘은 좀 크게 놀아 볼까.', '판돈은 신경 쓰지 마. 재미로 치는 거야.'],
    think: ['어디 보자…', '음, 이걸 낼까.', '사장은 서두르지 않아.'],
    go: ['고! 여기서 멈추면 사장 체면이 안 서지.', '고 간다. 돈은 쓰라고 있는 거야.', '고! 오늘 판은 내가 산다.'],
    goMore: ['{n}고! 겁먹었어?', '{n}고! 사장은 브레이크가 없어.', '또 고다! 끝까지 가 보자고.'],
    stop: ['스톱. 이 정도면 술값은 나왔네.', '여기까지. 욕심은 화를 부르는 법이지.', '스톱! 오늘은 이걸로 봐주지.'],
    ppeok: ['어허, 뻑이라니…', '이거 패가 왜 이래.', '…허허, 뻑. 웃어야지 뭐.'],
    otherPpeok: ['하하, 뻑! 그거 내 거다.', '뻑 났네? 잘 먹을게.', '어이쿠, 뻑이야? 고맙네.'],
    steal: ['피 한 장 내놔 봐.', '이게 사장 손맛이지.', '세금이야, 세금.'],
    robbed: ['어이, 살살 좀 해.', '내 피를 왜 가져가!', '허, 사장 피를 뜯어 가?'],
    bomb: ['폭탄이다! 다들 엎드려.', '쾅! 사장 폭탄 받아라.'],
    shake: ['흔든다. 각오들 해.', '흔들어 볼까? 판 커진다.'],
    nervous: ['어이쿠, 흔들어? 무섭네.', '폭탄? 젊은 사람이 화끈하구먼.'],
    humanGo: ['고? 배짱 하나는 좋네.', '그래, 가 보자고.', '고를 해? 사장 앞에서?'],
    gwang: ['광 들어온다~', '역시 광은 사장 몫이지.'],
    win: ['허허, 수업료라 생각해.', '오늘 술은 내가 쏜다!', '이게 사장의 클래스야.'],
    lose: ['…다음 판. 다음 판에 다 돌려받는다.', '내가 봐준 거야, 알지?', '허허, 오늘 운이 좋구먼.'],
    nagari: ['나가리? 다음 판 두 배로 가자고.', '나가리라… 판만 커졌네.'],
    raise: ['하프! 사장은 쪼잔하게 안 놀아.', '받아 볼 테면 받아 봐.', '올린다. 돈 걱정은 하지 마.'],
    call: ['받지.', '콜. 어디 보자고.'],
    fold: ['쳇, 이번 판은 접는다.', '다이. 다음에 보자고.'],
    check: ['일단 보지.'],
    bigHand: ['땡이다, 땡!', '봤지? 이게 사장 패야.'],
    trash: ['…망통이네. 허세였어.', '허허, 들켰구먼.'],
    humanRaise: ['오, 세게 나오네?', '그 돈 감당할 수 있겠어?'],
    redeal: ['다시? 좋지, 판 키우자고.']
  },
  // 깐깐한 단골 아주머니: 조심스럽고 수다스러움, 이기면 해맑음.
  '김여사': {
    hello: ['살살 해요, 다들.', '오늘은 조금만 칠게요.', '어머, 오늘 패 좀 들어오려나.'],
    think: ['가만있자…', '이거 내도 되나…', '음, 이게 맞나?'],
    go: ['고… 해 볼게요. 딱 한 번만.', '고! 어머, 나 미쳤나 봐.', '고 할게요. 말리지 마요.'],
    goMore: ['{n}고? 에라 모르겠다.', '{n}고! 아이고 심장이야.'],
    stop: ['스톱! 욕심내면 탈 나요.', '여기서 그만. 딱 좋아요.', '스톱이요~ 챙길 땐 챙겨야죠.'],
    ppeok: ['어머머, 뻑이야…', '아이고, 또 뻑.', '하… 오늘 패가 왜 이래요.'],
    otherPpeok: ['어머, 뻑! 그거 내가 먹을게요~', '호호, 뻑 났네요.'],
    steal: ['피 한 장만 줘요~', '이건 내가 챙길게요.', '어머, 미안해요. 호호.'],
    robbed: ['어머, 내 피!', '아이 참, 그걸 가져가요?', '너무하네 정말.'],
    bomb: ['폭탄이에요. 미안해요~'], shake: ['흔들게요. 조심하세요?'],
    nervous: ['어머, 흔들었어? 무서워라.', '아이고, 폭탄이래.'],
    humanGo: ['고요? 괜찮겠어요?', '어머, 또 가요?', '젊은 사람이 겁이 없네.'],
    gwang: ['광이다! 어머 좋아라.'],
    win: ['어머, 내가 이겼네? 호호.', '조심조심 치니까 되잖아요.', '오늘 저녁은 반찬 하나 더.'],
    lose: ['에휴, 오늘은 안 되는 날이네.', '내가 그럴 줄 알았어…', '아이고, 생활비…'],
    nagari: ['나가리네요. 아까워라.'],
    raise: ['하프. 이번엔 자신 있어요.', '저도 올릴게요.'],
    call: ['받을게요.', '음… 콜.'],
    fold: ['다이. 무리 안 해요.', '전 빠질게요~'],
    check: ['체크할게요.'],
    bigHand: ['어머, 땡이에요!', '이거 땡 맞죠? 호호.'],
    trash: ['망통… 다이할걸.'],
    humanRaise: ['어머, 그렇게 올려요?', '아이고, 세다.'],
    redeal: ['또 해요? 어휴.']
  },
  // 과묵한 타짜: 짧고 서늘하게.
  '타짜 정': {
    hello: ['패 섞어.', '시작하지.', '…'],
    think: ['…', '흠.'],
    go: ['고.', '…고.'], goMore: ['{n}고.', '한 번 더.', '고. 끝까지.'],
    stop: ['스톱.', '여기까지.'],
    ppeok: ['…뻑.', '흠.', '패가 장난을 치네.'],
    otherPpeok: ['뻑이군.', '손이 떨리나 봐?'],
    steal: ['피 한 장.', '보는 눈이 있어야지.', '그건 내 거.'],
    robbed: ['…두고 보지.', '그래, 가져가.'],
    bomb: ['터진다.'], shake: ['흔든다.'],
    nervous: ['흔들어 봤자.', '…재밌네.'],
    humanGo: ['고? 후회할 텐데.', '배짱은 인정.'],
    gwang: ['광.'],
    win: ['판은 원래 이렇게 끝나.', '수고했어.'],
    lose: ['…운이 좋았네.', '다음엔 없어.'],
    nagari: ['나가리. 다시.'],
    raise: ['하프.', '올리지.'], call: ['받지.'], fold: ['…다이.'], check: ['체크.'],
    bigHand: ['땡.'], trash: ['허세였어.'],
    humanRaise: ['블러핑이면 각오해.', '흠, 그 패로?'],
    redeal: ['다시 가지.']
  },
  // 들뜬 막내: 신조어, ㅋㅋ, 쉽게 신나고 쉽게 좌절.
  '막내': {
    hello: ['잘 부탁드려요 ㅎㅎ', '오늘 느낌 좋은데요?', '살살 해 주세요~'],
    think: ['음… 이거 각인데.', '잠깐만요!', '어떡하지…'],
    go: ['고고고!', '고 ㄱㄱ! 쫄리면 지는 거임.', '고! 가즈아!'],
    goMore: ['{n}고 ㅋㅋ 가즈아!', '또 고! 멈출 수 없어.'],
    stop: ['스톱! 챙길 땐 챙겨야죠.', '스톱 ㅎㅎ 존버 끝.'],
    ppeok: ['아 뻑 실화냐…', '헐 뻑… 망했다.', '뻑 ㅠㅠ'],
    otherPpeok: ['ㅋㅋㅋ 뻑! 개꿀.', '뻑 나셨네요 ㅎㅎ 잘 먹겠습니다!'],
    steal: ['피 한 장만요 ㅎㅎ', '개이득!', '감사합니다~ ㅋㅋ'],
    robbed: ['아 제 피 ㅠㅠ', '헐 너무해요.'],
    bomb: ['폭탄 투하~!'], shake: ['흔들어 버림 ㅋㅋ'],
    nervous: ['헐 흔드셨어요? 쫄리네.', '폭탄 ㄷㄷ'],
    humanGo: ['오 고 하심? 상남자ㄷㄷ', '고요? 리스펙.'],
    gwang: ['광 떴다 ㄷㄷ'],
    win: ['이겼다! 오늘 치킨 각.', 'ㅎㅎ 감사합니다~'],
    lose: ['아 졌다… 현타 온다.', '다음 판 복수함.'],
    nagari: ['나가리 ㅋㅋ 다음 판 두 배 가요!'],
    raise: ['하프 갑니다 ㅋㅋ', '올려요 올려!'], call: ['콜콜!'], fold: ['아 다이요 ㅠ'], check: ['체크~'],
    bigHand: ['땡 떴다!!'], trash: ['망통 ㅋㅋ 블러핑이었음'],
    humanRaise: ['헐 세게 가시네', '그거 블러핑이죠?'],
    redeal: ['또요? 좋아요!']
  },
  // 고스톱 단골 은하: 밝고 승부욕 강함.
  '은하': {
    hello: ['오늘은 제가 이길 거예요.', '자자, 패 돌려요!'],
    think: ['어디 보자~', '이거다!'],
    go: ['고! 이 정도론 부족하죠.', '고 할게요. 가 봅시다!'],
    goMore: ['{n}고! 오늘 끝장 봐요.'],
    stop: ['스톱! 깔끔하게.', '여기서 스톱이요~'],
    ppeok: ['아악, 뻑!', '뻑… 이건 반칙이지.'],
    otherPpeok: ['뻑이다! 그거 찜.', '오, 뻑! 잘 먹을게요.'],
    steal: ['피 한 장씩 주세요~', '이게 고스톱이죠!'],
    robbed: ['아, 내 피!', '두고 봐요, 돌려받을 거야.'],
    bomb: ['폭탄! 다들 피 내놔요.'], shake: ['흔들게요. 각오해요!'],
    nervous: ['흔들었어? 긴장되네.'],
    humanGo: ['고? 그럼 나도 안 져요.', '오, 승부사네.'],
    gwang: ['광 하나 추가!'],
    win: ['이겼다! 봤죠?', '오늘 컨디션 최고.'],
    lose: ['아, 아깝다! 다음 판!', '분하다… 한 판 더!'],
    nagari: ['나가리! 다음 판 두 배예요.']
  },
  // 고스톱 단골 태오: 무뚝뚝한 투덜이.
  '태오': {
    hello: ['…빨리 돌려요.', '오늘은 좀 되겠지.'],
    think: ['흠…', '이거나 내지.'],
    go: ['고. 어차피 해야지.', '…고.'],
    goMore: ['{n}고. 말리지 마.'],
    stop: ['스톱. 됐어.', '그만하지.'],
    ppeok: ['또 뻑이야…', '하, 진짜.', '내 그럴 줄 알았다.'],
    otherPpeok: ['뻑. 고맙네.', '뻑이네. 흐흐.'],
    steal: ['피 내놔.', '이건 받아 갈게.'],
    robbed: ['…쳇.', '그걸 가져가냐.'],
    bomb: ['폭탄.'], shake: ['흔든다.'],
    nervous: ['흔들어? …귀찮게 됐네.'],
    humanGo: ['고? 그래 봐.', '…겁도 없네.'],
    gwang: ['광이다.'],
    win: ['됐네.', '이번엔 내 차례였어.'],
    lose: ['…오늘 패 진짜 안 들어오네.', '쳇.'],
    nagari: ['나가리. 시간만 갔네.']
  },
  // 타짜 나이트: 거칠고 위압적인 노름꾼.
  '아귀': {
    hello: ['앉아. 패 돌린다.', '오늘 누구 하나 빈손으로 나간다.'],
    think: ['…', '어디 한번 보자.'],
    go: ['고. 판 키운다.', '고! 겁나면 일어나.'],
    goMore: ['{n}고. 끝장 보자.', '{n}고! 아직 멀었어.'],
    stop: ['스톱. 판 접어.', '여기까지다.'],
    ppeok: ['…뻑? 패가 날 시험하네.', '흥, 뻑이라.'],
    otherPpeok: ['뻑이네. 손 좀 봐야겠어.', '떨리냐? 뻑 났잖아.'],
    steal: ['피 내놔.', '판에선 뺏기는 놈이 바보야.'],
    robbed: ['…기억해 둔다.', '내 걸 건드려?'],
    bomb: ['터뜨린다.'], shake: ['흔든다. 각오해.'],
    nervous: ['흔들어? 재밌네.'],
    humanGo: ['고? 그 배짱 끝까지 가나 보자.', '고를 해? 좋아.'],
    gwang: ['광. 판은 내 거야.'],
    win: ['판은 원래 이렇게 끝나.', '돈 놓고 가.'],
    lose: ['…이 판, 기억해 둔다.', '다음 판에서 다 갚아 주지.'],
    nagari: ['나가리. 다음 판은 두 배다.']
  },
  // 타짜 나이트: 입담 좋은 꾼, 장난스럽고 말이 많음.
  '고광렬': {
    hello: ['자자, 오늘 밤 재밌겠네!', '형님들, 살살 하십쇼~'],
    think: ['가만, 가만…', '이걸 내야 사는데.'],
    go: ['고! 인생 뭐 있어?', '고 갑니다요~'],
    goMore: ['{n}고! 아이고 나 몰라!', '또 고! 오늘 끝까지 간다.'],
    stop: ['스톱! 먹을 때 먹어야지.', '스톱이요, 스톱!'],
    ppeok: ['아이고, 뻑이야!', '뻑… 오늘 손이 말을 안 듣네.'],
    otherPpeok: ['뻑! 이야, 땡큐!', '뻑 나셨네? 잘 먹겠습니다~'],
    steal: ['피 한 장 얻어 갑니다~', '이 맛에 치는 거지!'],
    robbed: ['아이고, 내 피!', '형님, 그건 너무하잖아요.'],
    bomb: ['폭탄이요! 쾅!'], shake: ['흔들어 봅니다~'],
    nervous: ['어이쿠, 흔드셨어?'],
    humanGo: ['고? 화끈하시네!', '오, 고! 멋있다.'],
    gwang: ['광이다, 광!'],
    win: ['하하, 오늘 장사 잘했네!', '감사합니다, 형님들~'],
    lose: ['아이고, 털렸다!', '다음 판엔 꼭 돌려받는다.'],
    nagari: ['나가리! 다음 판 두 배 가즈아.']
  }
};

// How eager each trigger is to be said. Calls that change the hand always get a line.
const CHANCE = {
  hello: 1, think: 0.08, go: 1, goMore: 1, stop: 1, ppeok: 1, otherPpeok: 0.6, steal: 0.6, robbed: 0.5,
  bomb: 1, shake: 0.9, nervous: 0.6, humanGo: 0.7, gwang: 0.45, win: 1, lose: 1, nagari: 1,
  raise: 0.7, call: 0.3, fold: 0.55, check: 0.15, bigHand: 0.9, trash: 0.6, humanRaise: 0.45, redeal: 1
};
// Lines that cut in even while someone else is still talking.
const LOUD = new Set(['go', 'goMore', 'stop', 'ppeok', 'bomb', 'win', 'lose', 'nagari', 'bigHand']);

const pickOf = (list, rnd) => list[Math.floor(rnd() * list.length)];

export function personaOf(name) {
  return PERSONAS[name] || HOUSE;
}

// One line for `name` on `trigger`, never the same one twice in a row for that person.
const lastSaid = new Map();
export function lineFor(name, trigger, { n = 1, rnd = Math.random } = {}) {
  const lines = personaOf(name)[trigger] || HOUSE[trigger];
  if (!lines?.length) return null;
  const key = `${name}:${trigger}`;
  let line = pickOf(lines, rnd);
  if (lines.length > 1 && line === lastSaid.get(key)) line = lines[(lines.indexOf(line) + 1) % lines.length];
  lastSaid.set(key, line);
  return line.replace('{n}', n);
}

const STEALS = new Set(['쪽', '따닥', '쓸', '뻑 먹기']);

// `anchor(seat)` is the element a seat's bubble hangs from; `who(seat)` is that seat's AI name,
// or null for a person (me, or a friend in a room), who never gets lines put in their mouth.
export function createBanter({ anchor, who, me = 0, rnd = Math.random }) {
  let quietUntil = 0;
  let greeted = false;
  const timers = new Map();

  function bubbleOf(seat) {
    const host = anchor(seat);
    if (!host) return null;
    let b = host.querySelector(':scope > .talk');
    if (!b) {
      b = el('span', 'talk');
      b.setAttribute('role', 'status');
      host.classList.add('has-talk');
      host.append(b);
    }
    return b;
  }

  function hide(seat) {
    clearTimeout(timers.get(seat));
    const b = anchor(seat)?.querySelector(':scope > .talk');
    b?.classList.remove('is-shown');
  }

  // Says `trigger` for `seat` if that seat is an AI and the dice allow. Returns the line said.
  function say(seat, trigger, { n = 1, force = false } = {}) {
    const name = who(seat);
    if (!name) return null;
    const loud = force || LOUD.has(trigger);
    const now = performance.now();
    if (!loud && now < quietUntil) return null;
    if (!force && rnd() > (CHANCE[trigger] ?? 0.5)) return null;
    const text = lineFor(name, trigger, { n, rnd });
    const b = text && bubbleOf(seat);
    if (!b) return null;
    quietUntil = now + 1500;
    for (const s of timers.keys()) if (s !== seat) hide(s);
    b.textContent = text;
    b.classList.remove('is-shown');
    void b.offsetWidth;
    b.classList.add('is-shown');
    clearTimeout(timers.get(seat));
    timers.set(seat, setTimeout(() => b.classList.remove('is-shown'), Math.max(ms(2000 + text.length * 45), 1600)));
    return text;
  }

  const ais = seats => seats.filter(s => s !== me && who(s));
  const someone = (seats, except = -1) => { const list = ais(seats).filter(s => s !== except); return list.length ? pickOf(list, rnd) : -1; };

  return {
    say,
    clear() { for (const s of [...timers.keys()]) hide(s); quietUntil = 0; },
    // The first hand at a table gets a hello from one of the AI.
    hello(seats) { if (greeted) return; greeted = true; const s = someone(seats); if (s >= 0) say(s, 'hello', { force: true }); },

    // 맞고 / 고스톱: one event from the server, before it plays out on the felt.
    hwatu(e, seats) {
      if (e.type === 'play' && e.seat !== me) return void say(e.seat, 'think');
      if (e.type === 'capture' && e.seat !== me && e.cards?.some(id => hwatu(id)?.kind === 'gwang')) return void say(e.seat, 'gwang');
      if (e.type !== 'call') return;
      const text = e.text, mine = e.seat === me || !who(e.seat);
      const go = /^(\d+)고$/.exec(text);
      if (go) {
        const n = Number(go[1]);
        if (!mine) say(e.seat, n >= 2 ? 'goMore' : 'go', { n });
        else { const s = someone(seats, e.seat); if (s >= 0) say(s, 'humanGo'); }
      } else if (text === '스톱') { if (!mine) say(e.seat, 'stop'); }
      else if (text === '뻑') {
        if (!mine) say(e.seat, 'ppeok');
        else { const s = someone(seats, e.seat); if (s >= 0) say(s, 'otherPpeok'); }
      } else if (STEALS.has(text)) {
        if (!mine) say(e.seat, 'steal');
        else { const s = someone(seats, e.seat); if (s >= 0) say(s, 'robbed'); }
      } else if (text === '폭탄' || text === '흔들기') {
        if (!mine) say(e.seat, text === '폭탄' ? 'bomb' : 'shake');
        else { const s = someone(seats, e.seat); if (s >= 0) say(s, 'nervous'); }
      }
    },
    // The end of a 맞고 / 고스톱 hand: the winner gloats, or a loser grumbles.
    hwatuResult(r, seats) {
      if (!r) return;
      if (r.winner === null || r.winner === undefined) { const s = someone(seats); if (s >= 0) say(s, 'nagari', { force: true }); return; }
      if (who(r.winner) && r.winner !== me) return void say(r.winner, 'win', { force: true });
      const s = someone(seats, r.winner);
      if (s >= 0) say(s, 'lose', { force: true });
    },

    // 섯다: a bet as it lands on the felt.
    seotdaBet(e, seats) {
      const raise = e.action === 'HALF' || e.action === 'BBING' || e.action === 'DDADANG' || e.action === 'ALLIN';
      if (e.seat === me || !who(e.seat)) {
        if (e.action === 'HALF' || e.action === 'DDADANG' || e.action === 'ALLIN') { const s = someone(seats, e.seat); if (s >= 0) say(s, 'humanRaise'); }
        return;
      }
      say(e.seat, raise ? 'raise' : e.action === 'CALL' ? 'call' : e.action === 'DIE' ? 'fold' : 'check');
    },
    // 섯다 showdown: big hands brag, 망통 bluffs own up. One remark per showdown.
    seotdaReveal(e) {
      const names = e.names || [];
      const big = names.findIndex((x, s) => s !== me && who(s) && /땡/.test(x || '') && !/땡잡이/.test(x));
      if (big >= 0) return void say(big, 'bigHand');
      const bust = names.findIndex((x, s) => s !== me && who(s) && x === '망통');
      if (bust >= 0) say(bust, 'trash');
    },
    seotdaResult(r, seats) {
      if (!r) return;
      const aiWin = r.winners.find(s => s !== me && who(s));
      if (aiWin !== undefined && !r.winners.includes(me)) return void say(aiWin, 'win', { force: true });
      const losers = seats.filter(s => !r.winners.includes(s));
      const s = someone(losers);
      if (s >= 0) say(s, 'lose', { force: true });
    },
    seotdaRedeal(seats) { quietUntil = 0; const s = someone(seats); if (s >= 0) say(s, 'redeal'); }
  };
}
