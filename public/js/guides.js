// What the coach says at each table, and the rules sheet behind "?". Each step can light up a
// selector on the real table and, with `until`, wait for the player to do it themselves.
// To add a game, export another entry keyed by its lobby id (for example `poker`).
import { hwatuSvg } from './hwatu.js';

const hw = (...ids) => ids.map(id => `<span class="hw is-faceup"><span class="hw-inner"><span class="hw-face">${hwatuSvg(id)}</span></span></span>`).join('');

// ---------- shared betting steps ----------
const started = { enter: (t, s) => { s.last = t.lastBet; }, until: (t, s) => t.locked || t.lastBet !== s.last };
const finished = { enter: (t, s) => { s.last = t.lastBet; s.was = t.locked; }, until: (t, s) => (s.was ? !t.locked : t.lastBet !== s.last && !t.locked) };

function betSteps({ zone, zoneTitle, zoneBody, startLabel = '딜' }) {
  return [
    { target: '.chip-tray', title: '칩 고르기', body: ['아래 다섯 개가 이 테이블의 칩이에요. 탭한 칩이 살짝 올라와 선택돼요.', '테이블마다 최소·최대 베팅이 정해져 있어요.'] },
    { target: zone, title: zoneTitle, body: [zoneBody, '칩을 탭해도 되고, 칩을 눌러 펠트 위로 끌어다 놓아도 돼요.'], do: '칩을 하나 놓아 보세요', until: t => t.total > 0 },
    { target: '.bet-tools', title: '금액 다듬기', body: '되돌리기는 마지막 칩 하나를 빼고, ½과 ×2는 지금 베팅을 절반이나 두 배로 바꿔요. 오른쪽 위 보유 칩도 같이 움직여요.' },
    { target: '[data-actions]', title: `${startLabel} 누르기`, body: '최소 베팅을 넘기면 버튼이 켜져요. 같은 금액으로 다시 하려면 판이 끝난 뒤 다시 베팅을 누르면 돼요.', do: `${startLabel}를 눌러 시작해 보세요`, ...started }
  ];
}
// The AI regulars on the rail at baccarat, roulette and sic bo.
const crowdStep = { target: '.crowd', title: '함께 앉은 손님', body: ['NOVA, REX, LUNA 같은 AI 플레이어들도 같은 판에 자기 칩을 걸어요. 가끔 한마디씩 하기도 해요.', '그들의 칩은 테이블 분위기를 위한 연출이라 내 베팅과 보유 칩에는 영향이 없어요. 결과가 나오면 나와 똑같은 규칙으로 지급되거나 걷혀요.'] };
const helpStep = { target: '.table-help', title: '언제든 다시 보기', body: '? 버튼에 규칙표와 이 가이드가 있어요. 가이드는 처음 앉을 때 한 번만 저절로 열려요.' };

export const GUIDES = {
  blackjack: {
    id: 'blackjack', title: '블랙잭',
    steps: [
      { target: '.felt', title: '블랙잭은 21 싸움', body: ['딜러보다 21에 가까우면 이겨요. 21을 넘기면 그 자리에서 져요(버스트).', '그림 카드는 10, A는 1 또는 11로 셉니다.'] },
      ...betSteps({ zone: '.bj-spots', zoneTitle: '베팅 박스에 칩 놓기', zoneBody: '원 하나가 손 하나예요. 박스 세 개까지 따로 걸면 세 손을 동시에 칠 수 있어요.' }),
      { target: '.bj-spots', title: '내 카드', body: ['박스마다 카드 두 장, 딜러는 한 장이 열려요. 합계는 카드 옆 숫자로 보여요.', '딜러가 A를 보이면 인슈어런스를 먼저 묻는데, 딜러가 블랙잭일 때 2배로 돌려받는 보험이에요.'] },
      { target: '[data-actions]', title: '히트 · 스탠드 · 더블', body: ['히트는 한 장 더, 스탠드는 여기서 멈추기예요.', '더블은 베팅을 두 배로 올리고 딱 한 장만 받아요. 같은 숫자 두 장이면 스플릿으로 두 손으로 나눌 수 있어요.'], do: '이번 판을 끝까지 해 보세요', ...finished },
      { target: '.felt', title: '정산', body: '이기면 건 만큼 받고, 처음 두 장이 21(블랙잭)이면 1.5배를 받아요. 딜러는 17 이상이면 멈춥니다.' },
      helpStep
    ],
    rules: `<h3>목표</h3><p>딜러보다 21에 가깝게. 21을 넘기면 버스트로 바로 집니다.</p>
      <h3>카드 값</h3><ul><li>2–10은 숫자 그대로, J·Q·K는 10</li><li>A는 1 또는 11 중 유리한 쪽</li></ul>
      <h3>행동</h3><table><tr><td>히트</td><td>한 장 더</td></tr><tr><td>스탠드</td><td>멈추기</td></tr><tr><td>더블</td><td>베팅 2배, 한 장만</td></tr><tr><td>스플릿</td><td>같은 카드 두 장을 두 손으로</td></tr><tr><td>인슈어런스</td><td>딜러 A일 때 베팅의 절반, 2 : 1</td></tr></table><p>베팅 박스는 3개까지, 박스마다 따로 걸 수 있어요.</p>
      <h3>배당</h3><table><tr><td>승리</td><td>1 : 1</td></tr><tr><td>블랙잭</td><td>3 : 2</td></tr><tr><td>무승부</td><td>베팅 돌려받음</td></tr></table><p>딜러는 소프트 17 포함 17 이상에서 멈춥니다.</p>`
  },

  baccarat: {
    id: 'baccarat', title: '바카라',
    steps: [
      { target: '.bac-sides', title: '어느 쪽이 9에 가까울까', body: ['플레이어와 뱅커 중 끝자리가 9에 가까운 쪽이 이겨요. 카드는 딜러가 규칙대로 돌리니 나는 고르기만 하면 돼요.', '10·J·Q·K는 0, A는 1. 합이 15면 5로 봐요.'] },
      ...betSteps({ zone: '.bac-zones', zoneTitle: '어디에 걸까', zoneBody: 'Player, Tie, Banker 가운데 한 곳에 걸어요. 다른 칸을 탭하면 칩이 그쪽으로 옮겨 가요.' }),
      { target: '.bac-pairs', title: '페어 사이드 베팅', body: ['P Pair는 플레이어, B Pair는 뱅커의 처음 두 장이 같은 숫자(K·K, 7·7)면 11배를 받아요. 승패와 상관없이 따로 정산돼요.', '메인 베팅과 함께 원하는 만큼 얹을 수 있어요.'] },
      { target: '.bac-sides', title: '카드 쪼기', body: '내가 건 쪽 카드는 천천히 쪼여서 열려요. 필요하면 세 번째 카드가 옆으로 눕혀져 나와요.' },
      { target: '.road', title: '지난 결과', body: '최근 결과가 점으로 쌓여요. P는 플레이어, B는 뱅커, T는 타이예요.' },
      crowdStep,
      helpStep
    ],
    rules: `<h3>점수</h3><p>카드 합의 끝자리. 10·J·Q·K는 0, A는 1. 처음 두 장이 8이나 9면 내추럴로 바로 끝나요.</p>
      <h3>배당</h3><table><tr><td>Player</td><td>1 : 1</td></tr><tr><td>Banker</td><td>0.95 : 1</td></tr><tr><td>Tie</td><td>8 : 1</td></tr><tr><td>P Pair / B Pair</td><td>11 : 1</td></tr></table>
      <p>타이가 나오면 Player·Banker에 건 칩은 돌려받아요. 세 번째 카드는 정해진 표대로 자동으로 나와요.</p>
      <p>페어는 그쪽 처음 두 장이 같은 숫자일 때만 이겨요(세 번째 카드는 세지 않아요). Player·Banker·Tie 중 한 곳에 메인 베팅이 있어야 걸 수 있어요.</p>
      <p>같은 테이블의 AI 플레이어 칩은 연출이에요. 내 칩과 정산에는 영향이 없어요.</p>`
  },

  roulette: {
    id: 'roulette', title: '룰렛',
    steps: [
      { target: '.wheel', title: '공이 멈출 칸 맞히기', body: '0부터 36까지 37칸짜리 유럽식 휠이에요. 공이 멈춘 숫자로 승패가 정해져요.' },
      ...betSteps({ zone: '.rl-layout', zoneTitle: '숫자 판에 걸기', zoneBody: '여러 곳에 한꺼번에 걸 수 있어요. 숫자 하나는 35배, 12개 묶음과 2:1 열은 2배, 빨강·검정, 홀·짝, 1–18·19–36은 1배예요.', startLabel: '스핀' }),
      { target: '.rl-history', title: '최근 숫자', body: '방금 나온 숫자가 맨 앞에 쌓여요. 휠에는 기억이 없으니 다음 판은 언제나 새 판이에요.' },
      crowdStep,
      helpStep
    ],
    rules: `<h3>배당</h3><table><tr><td>숫자 하나</td><td>35 : 1</td></tr><tr><td>12개 묶음 / 열 (2:1)</td><td>2 : 1</td></tr><tr><td>빨강 / 검정</td><td>1 : 1</td></tr><tr><td>홀 / 짝</td><td>1 : 1</td></tr><tr><td>1–18 / 19–36</td><td>1 : 1</td></tr></table><p>한 판에 여러 곳에 동시에 걸 수 있고, 각 자리는 따로 정산돼요. 0이 나오면 바깥쪽 베팅은 모두 집니다.</p><p>숫자 칸 모서리의 작은 칩은 AI 플레이어들의 베팅이에요. 연출일 뿐 내 칩과 정산에는 영향이 없어요.</p>`
  },

  dice: {
    id: 'dice', title: '식보',
    steps: [
      { target: '.dome', title: '주사위 세 개', body: '유리 돔 안에서 주사위 세 개가 굴러요. 세 눈의 합과 모양을 맞혀요.' },
      ...betSteps({ zone: '.sb-main', zoneTitle: '어디에 걸까', zoneBody: 'Small은 합 4–10, Big은 11–17이에요. 아래 숫자 칸은 합 하나를 맞히는 대신 배당이 커요.', startLabel: '굴리기' }),
      { target: '.sb-totals', title: '합 맞히기', body: '4나 17처럼 잘 안 나오는 합일수록 배당이 커요. 칸 아래 숫자가 배당이에요.' },
      crowdStep,
      helpStep
    ],
    rules: `<h3>배당</h3><table><tr><td>Small (4–10) / Big (11–17)</td><td>1 : 1</td></tr><tr><td>홀 / 짝</td><td>1 : 1</td></tr><tr><td>아무 트리플</td><td>24 : 1</td></tr><tr><td>합 4 · 17</td><td>50 : 1</td></tr><tr><td>합 10 · 11</td><td>6 : 1</td></tr></table><p>세 개가 같은 눈(트리플)이면 Small·Big·홀짝은 집니다.</p><p>함께 앉은 AI 플레이어들의 칩은 연출이에요. 내 칩과 정산에는 영향이 없어요.</p>`
  },

  matgo: {
    id: 'matgo', title: '맞고',
    steps: [
      { target: '.felt', title: '맞고는 둘이 치는 고스톱', body: ['같은 달(같은 그림)끼리 짝을 맞춰 가져와요. 먼저 7점을 내면 고 또는 스톱을 외칠 수 있어요.', '카드 왼쪽 아래 숫자가 달이에요. 1월 송학부터 12월 비까지 달마다 넉 장씩 있어요.'] },
      { target: '[data-zone="POINT"]', title: '점당 정하기', body: ['칩으로 점당 금액을 정해요. 이기면 점수 × 점당을 받고, 지면 그만큼 내요.', '시작할 때 10점치를 보증금으로 잡아 두고, 끝나면 정산해요.'], do: '칩을 탭해 점당을 올려 보세요', until: t => t.total > 0 },
      { target: '[data-actions]', title: '패 받기', body: '최소 금액을 넘기면 시작을 누를 수 있어요. 내 패 10장, 바닥 8장, 상대 10장이 돌아가요.', do: '시작을 눌러 보세요', until: t => t.mg?.view?.status === 'PLAYING' || t.locked },
      { target: '.mg-hand', title: '내 패', body: ['위에 흰 점이 있는 카드는 바닥에 같은 달이 있는 카드예요. 내면 짝을 맞춰 가져와요.', '짝이 없으면 바닥에 깔려요. 상대가 가져갈 수 있으니 주의!'] },
      { target: '.mg-hand', title: '내기', body: '카드를 한 번 탭하면 들리고, 한 번 더 탭하면 내요. 내고 나면 가운데 더미에서 한 장이 저절로 뒤집혀 한 번 더 짝을 찾아요.', do: '패 한 장을 내 보세요', enter: (t, s) => { s.p = t.mg?.plays ?? 0; }, until: (t, s) => (t.mg?.plays ?? 0) > s.p },
      { target: '[data-caps="0"]', title: '먹은 패', body: ['가져온 패는 광 · 끗 · 띠 · 피로 나뉘어 쌓여요.', '광 3장 3점, 끗·띠는 5장부터 1점, 피는 10장부터 1점. 고도리(새 세 마리)는 5점, 홍단·청단·초단은 3점이에요.'] },
      { target: '.mg-board', title: '쪽 · 뻑 · 따닥 · 쓸', body: ['낸 패와 뒤집은 패가 같은 달로 맞으면 쪽, 바닥에 짝을 맞췄는데 뒤집은 패가 또 같은 달이면 뻑(세 장이 바닥에 남아요).', '쪽·따닥·쓸, 뻑 먹기를 하면 상대 피를 한 장 뺏어 와요.'] },
      { target: '[data-actions]', title: '고 또는 스톱', body: ['7점이 나면 고(계속, 1고 +1점, 3고부터 2배) 또는 스톱(지금 점수로 승리)을 골라요.', '고를 불렀다가 상대가 먼저 나면 고박으로 두 배를 물어요. 피박·광박·흔들기도 두 배예요.'] },
      helpStep
    ],
    rules: `<h3>흐름</h3><ol><li>패를 한 장 내서 바닥의 같은 달과 짝을 맞춰요.</li><li>더미 맨 위 한 장을 뒤집어 한 번 더 짝을 찾아요.</li><li>짝이 맞은 패는 가져와요. 7점이 나면 고 또는 스톱.</li></ol>
      <h3>점수</h3><table>
        <tr><td>${hw('01-1', '03-1', '08-1')} 광 3장</td><td>3점 (비광 끼면 2점)</td></tr>
        <tr><td>광 4장 · 5장</td><td>4점 · 15점</td></tr>
        <tr><td>${hw('02-1', '04-1', '08-2')} 고도리</td><td>5점</td></tr>
        <tr><td>${hw('01-2', '02-2', '03-2')} 홍단</td><td>3점</td></tr>
        <tr><td>${hw('06-2', '09-2', '10-2')} 청단</td><td>3점</td></tr>
        <tr><td>${hw('04-2', '05-2', '07-2')} 초단</td><td>3점</td></tr>
        <tr><td>끗 · 띠 5장</td><td>1점, 한 장마다 +1</td></tr>
        <tr><td>피 10장 (${hw('11-2', '12-4')} 쌍피는 2장)</td><td>1점, 한 장마다 +1</td></tr>
      </table><p>${hw('09-1')} 9월 국진은 끗이나 쌍피 중 점수가 높은 쪽으로 자동 계산돼요.</p>
      <h3>두 배가 되는 경우</h3><table><tr><td>3고 이상</td><td>3고 2배, 4고 4배…</td></tr><tr><td>흔들기 · 폭탄</td><td>같은 달 석 장, 2배</td></tr><tr><td>피박</td><td>피로 났는데 상대 피 1–7장</td></tr><tr><td>광박</td><td>광으로 났는데 상대 광 0장</td></tr><tr><td>고박</td><td>상대가 고 했다가 내가 남</td></tr><tr><td>멍따</td><td>끗 7장 이상</td></tr></table>
      <h3>피 뺏기</h3><p>쪽, 따닥, 쓸(바닥을 다 쓸어감), 뻑 먹기, 폭탄을 하면 상대 피를 한 장 가져와요. 둘 다 스톱 못 하고 패가 떨어지면 나가리(무승부)예요.</p>
      <h3>칩</h3><p>이긴 점수 × 점당을 받고 지면 그만큼 내요. 시작할 때 10점치를 보증금으로 잡아요.</p>`
  },

  gostop: {
    id: 'gostop', title: '고스톱',
    steps: [
      { target: '.felt', title: '셋이서 치는 고스톱', body: ['나와 AI 둘이 돌아가며 패를 내요. 같은 달끼리 짝을 맞춰 가져오는 건 맞고와 같아요.', '맞고와 달리 3점만 나면 고 또는 스톱을 외칠 수 있어요.'] },
      { target: '[data-zone="POINT"]', title: '점당 정하기', body: ['칩으로 점당 금액을 정해요. 이기면 진 두 사람에게 각자 점수 × 점당을 받아요.', '시작할 때 10점치를 보증금으로 잡아 두고, 끝나면 정산해요.'], do: '칩을 탭해 점당을 올려 보세요', until: t => t.total > 0 },
      { target: '[data-actions]', title: '패 받기', body: '시작을 누르면 바닥 6장, 세 사람에게 7장씩 돌아가요.', do: '시작을 눌러 보세요', until: t => t.gs?.view?.status === 'PLAYING' || t.locked },
      { target: '.gs-opp', title: 'AI 두 명', body: ['위쪽(가로 화면에서는 양옆) 두 자리가 AI예요. 남은 패 수, 먹은 패, 점수가 보여요.', 'AI 차례에는 이름이 불리고, AI가 낸 패와 고·스톱이 그대로 보여요.'] },
      { target: '.mg-hand', title: '내기', body: '흰 점이 있는 카드는 바닥에 같은 달이 있어요. 한 번 탭하면 들리고, 한 번 더 탭하면 내요.', do: '패 한 장을 내 보세요', enter: (t, s) => { s.p = t.gs?.plays ?? 0; }, until: (t, s) => (t.gs?.plays ?? 0) > s.p },
      { target: '.mg-board', title: '피는 두 사람에게서', body: ['쪽 · 따닥 · 쓸 · 뻑 먹기 · 폭탄을 하면 두 AI에게서 피를 한 장씩 뺏어 와요.', 'AI가 하면 내 피도 한 장 나가요.'] },
      { target: '[data-actions]', title: '고 또는 스톱', body: ['3점이 나면 고(1고 +1, 2고 +2, 3고부터 2배씩) 또는 스톱.', '고를 불렀다가 다른 사람이 먼저 나면 고박: 두 사람 몫을 혼자 물어요.'] },
      helpStep
    ],
    rules: `<h3>흐름</h3><ol><li>바닥 6장, 세 사람에게 7장씩. 남은 21장이 더미예요.</li><li>차례대로 한 장 내고, 더미 맨 위를 뒤집어 짝을 찾아요.</li><li>3점이 나면 고 또는 스톱. 아무도 스톱 못 하고 패가 떨어지면 나가리예요.</li></ol>
      <h3>점수</h3><p>맞고와 같아요: 광 3장 3점(비광 끼면 2점), 고도리 5점, 홍단·청단·초단 3점, 끗·띠 5장부터, 피 10장부터 1점씩.</p>
      <h3>두 배가 되는 경우</h3><table><tr><td>3고 이상</td><td>3고 2배, 4고 4배…</td></tr><tr><td>흔들기 · 폭탄</td><td>2배</td></tr><tr><td>멍따</td><td>끗 7장 이상</td></tr><tr><td>피박 (진 사람마다)</td><td>피로 났는데 그 사람 피 1–5장</td></tr><tr><td>광박 (진 사람마다)</td><td>광으로 났는데 그 사람 광 0장</td></tr></table>
      <h3>고박</h3><p>고를 불렀던 사람이 지면 다른 진 사람 몫까지 혼자 내요.</p>
      <h3>칩</h3><p>이긴 사람이 진 사람마다 점수 × 점당을 받아요. 내가 이기면 두 사람 몫을, 지면 내 몫을 내요. 시작할 때 10점치를 보증금으로 잡고, 그보다 크게 지면 보유 칩에서 나머지를 내요.</p>`
  },

  seotda: {
    id: 'seotda', title: '섯다',
    steps: [
      { target: '.felt', title: '섯다는 두 장 족보 싸움', body: ['1월부터 10월까지 화투 스무 장만 써요. 끝까지 남은 사람 중 두 장의 조합(족보)이 가장 높은 사람이 판을 모두 가져가요.'] },
      { target: '.sd-count', title: '상대 수 고르기', body: '시작 전에 상대를 1명에서 4명까지 고를 수 있어요. 많을수록 판이 커지고 이기기는 어려워져요.' },
      { target: '[data-zone="ANTE"]', title: '판돈 걸기', body: '칩으로 기본 판돈을 정해요. 테이블의 모두가 똑같이 걸고 시작해요.', do: '칩을 탭해 판돈을 놓아 보세요', until: t => t.total > 0 },
      { target: '[data-actions]', title: '패 받기', body: '시작을 누르면 한 장씩 받아요. 내 카드만 보이고 상대 카드는 끝날 때까지 뒷면이에요.', do: '시작을 눌러 보세요', ...started },
      { target: '[data-actions]', title: '첫 베팅', body: ['체크는 넘기기, 삥은 판돈만큼, 하프는 판의 절반을 더 걸어요.', '누가 걸면 콜(따라가기), 하프(더 올리기), 다이(포기) 중에 골라요. 순서대로 돌아가며 모두 같은 금액을 걸면 다음 장이에요.'], do: '첫 베팅을 해 보세요', until: t => !t.sd?.view || t.sd.view.street === 2 || t.sd.view.status !== 'PLAYING' },
      { target: '[data-cards="0"]', title: '두 번째 장 쪼기', body: '두 번째 장은 천천히 쪼여서 열려요. 내 족보가 카드 위에 나와요.' },
      { target: '.table-help', title: '족보 순서', body: ['38광땡 › 13·18광땡 › 장땡(10땡) › 9땡 … 1땡 › 알리(1·2) › 독사(1·4) › 구삥 › 장삥 › 장사 › 세륙 › 갑오(9끗) … 망통(0끗).', '땡잡이(3광·7)는 판에서 가장 높은 패가 1~9땡일 때, 암행어사(4·7 열끗)는 13·18광땡일 때만 잡아요. 구사(4·9)는 남은 상대가 모두 알리 이하면 재경기예요.'] },
      helpStep
    ],
    rules: `<h3>흐름</h3><ol><li>나와 상대 1~4명이 판돈을 똑같이 걸어요.</li><li>한 장씩 받고 차례대로 베팅, 한 장 더 받고 마지막 베팅.</li><li>끝까지 남은 사람끼리 패를 까서 족보가 가장 높은 사람이 판을 모두 가져가요. 다이하면 그때까지 건 돈은 판에 남아요.</li></ol>
      <h3>베팅</h3><table><tr><td>체크</td><td>넘기기</td></tr><tr><td>삥</td><td>판돈만큼</td></tr><tr><td>하프</td><td>판의 절반 더</td></tr><tr><td>콜</td><td>가장 많이 건 사람만큼 따라가기</td></tr><tr><td>다이</td><td>포기</td></tr></table><p>한 번의 베팅에서 올리기는 두 번까지예요.</p>
      <h3>족보 (높은 순)</h3><table>
        <tr><td>${hw('03-1', '08-1')} 38광땡</td><td>최고</td></tr>
        <tr><td>${hw('01-1', '03-1')} ${hw('01-1', '08-1')} 13 · 18광땡</td><td></td></tr>
        <tr><td>${hw('10-1', '10-3')} 장땡 › 9땡 … 1땡</td><td>같은 달 두 장</td></tr>
        <tr><td>${hw('01-1', '02-1')} 알리</td><td>1 · 2</td></tr>
        <tr><td>독사 · 구삥 · 장삥</td><td>1·4 · 1·9 · 1·10</td></tr>
        <tr><td>장사 · 세륙</td><td>10·4 · 4·6</td></tr>
        <tr><td>갑오 › 8끗 … 1끗 › 망통</td><td>두 장 합의 끝자리</td></tr>
      </table>
      <h3>특수패</h3><table>
        <tr><td>${hw('03-1', '07-1')} 땡잡이</td><td>판의 최고가 1~9땡이면 잡음, 아니면 망통</td></tr>
        <tr><td>${hw('04-1', '07-1')} 암행어사</td><td>판의 최고가 13·18광땡이면 잡음, 아니면 1끗</td></tr>
        <tr><td>${hw('04-3', '09-3')} 구사</td><td>남은 상대가 모두 알리 이하면 재경기</td></tr>
        <tr><td>${hw('04-1', '09-1')} 멍텅구리구사</td><td>남은 상대가 모두 9땡 이하면 재경기</td></tr>
      </table><p>재경기는 판돈을 그대로 두고 남은 사람끼리 새로 받아요. 같은 족보로 이기면 판을 똑같이 나눠요. 하우스는 수수료를 떼지 않아요.</p>`
  },

  slots: {
    id: 'slots', title: '슬롯',
    steps: [
      { target: '.slot-jackpot', title: '프로그레시브 잭팟', body: ['모든 플레이어의 스핀이 베팅의 2%씩 이 잭팟에 쌓여요.', '별 세 개가 가운데 줄에 서면 잭팟이에요. 테이블 최대 베팅이면 전부, 적게 걸면 그 비율만큼 받아요.'] },
      ...betSteps({ zone: '[data-zone="LINE"]', zoneTitle: '베팅', zoneBody: '칩을 놓은 만큼이 한 번 스핀의 베팅이에요.', startLabel: '스핀' }),
      { target: '[data-lever]', title: '레버', body: '오른쪽 레버를 당겨도 돌아가요. 릴은 하나씩 멈춰요.' },
      { target: '.slot-pays', title: '배당', body: ['가운데 줄 세 칸만 봐요. 별은 아무 그림이나 대신하는 와일드예요.', '별 하나가 끼면 2배, 둘이면 3배로 불어나요.'] },
      helpStep
    ],
    rules: `<h3>배당 (베팅 대비)</h3><table><tr><td>★ ★ ★</td><td>잭팟 + 500배</td></tr><tr><td>7 7 7</td><td>80배</td></tr><tr><td>트리플 바 3개</td><td>40배</td></tr><tr><td>더블 바 3개</td><td>20배</td></tr><tr><td>바 3개</td><td>10배</td></tr><tr><td>같은 무늬 3개</td><td>6배</td></tr><tr><td>바 아무거나 3개</td><td>4배</td></tr><tr><td>빨강 또는 검정 무늬 3개</td><td>2배</td></tr><tr><td>★ 두 개</td><td>10배</td></tr><tr><td>★ 한 개</td><td>본전</td></tr></table>
      <p>★은 와일드예요. 별 한 개가 끼어 줄이 맞으면 2배, 두 개면 3배. 모든 스핀의 2%가 잭팟에 쌓이고, 별 세 개는 테이블 최대 베팅 대비 비율만큼 잭팟을 가져가요.</p>`
  },

  poker: {
    id: 'poker', title: "Hold'em",
    steps: [
      { target: '.felt', title: '텍사스 홀덤', body: ['내 카드 두 장과 가운데 공용 카드 다섯 장 중 다섯 장으로 가장 좋은 패를 만들어요.', '끝까지 남거나 쇼다운에서 패가 제일 높으면 팟을 가져가요.'] },
      { target: '.chip-tray', title: '칩 고르기', body: '아래 칩을 탭하면 선택돼요. 첫 칩은 이 테이블의 빅 블라인드예요.' },
      { target: '[data-zone="buyin"]', title: '바이인', body: ['Buy-in 원에 놓은 칩이 테이블에 들고 앉는 스택이에요.', '일어나면 남은 스택이 지갑으로 돌아와요.'], do: '칩을 하나 놓아 보세요', until: t => t.total > 0 },
      { target: '.pk-opponents', title: '상대 수', body: 'AI 상대를 1명부터 5명까지 고를 수 있어요. 봇마다 성격이 달라서 꽉 막힌 봇도, 자주 올리는 봇도 있어요.' },
      { target: '[data-actions]', title: '앉기', body: '바이인이 정해지면 앉기를 눌러요. 카드가 자리마다 날아가요.', do: '앉기를 눌러 보세요', until: t => t.root.classList.contains('is-seated') },
      { target: '.pk-seat--hero', title: '내 자리', body: ['맨 아래가 내 자리예요. 내 차례가 되면 자리가 밝아져요.', 'D 버튼이 딜러 자리이고, 그 다음 두 자리가 스몰·빅 블라인드를 내요.'] },
      { target: '[data-board]', title: '공용 카드', body: '플랍 세 장, 턴 한 장, 리버 한 장 순서로 열려요. 장마다 한 번씩 베팅이 돌아요.' },
      { target: '[data-actions]', title: '폴드 · 체크 · 콜 · 레이즈', body: ['폴드는 이번 핸드 포기, 체크는 그냥 넘기기, 콜은 앞 사람 금액 맞추기예요.', '레이즈 금액은 ½ 팟·팟·올인 버튼이나 슬라이더로 정해요. 키보드 F·C·R도 돼요.'] },
      { target: '[data-actions]', title: '다음 핸드 · 일어나기', body: '핸드가 끝나면 다음 핸드로 계속하거나, 일어나서 스택을 지갑으로 돌려받아요. 스택이 0이 되면 자동으로 일어나요.' },
      helpStep
    ],
    rules: `<h3>진행</h3><p>블라인드 → 내 카드 2장 → 베팅 → 플랍 3장 → 베팅 → 턴 → 베팅 → 리버 → 베팅 → 쇼다운</p>
      <h3>족보 (높은 순)</h3><table><tr><td>로열 플러시</td><td>같은 무늬 A K Q J 10</td></tr><tr><td>스트레이트 플러시</td><td>같은 무늬 연속 다섯 장</td></tr><tr><td>포카드</td><td>같은 숫자 넉 장</td></tr><tr><td>풀하우스</td><td>트리플 + 원페어</td></tr><tr><td>플러시</td><td>같은 무늬 다섯 장</td></tr><tr><td>스트레이트</td><td>연속 숫자 다섯 장</td></tr><tr><td>트리플</td><td>같은 숫자 석 장</td></tr><tr><td>투페어</td><td>페어 두 개</td></tr><tr><td>원페어</td><td>같은 숫자 두 장</td></tr><tr><td>하이카드</td><td>가장 높은 카드</td></tr></table>
      <p>레이즈는 직전 레이즈만큼 이상 올려야 해요. 올인한 사람은 자기가 넣은 만큼까지만 팟을 가져가요(사이드 팟).</p>`
  }
};
