// 카카오톡·문자 링크 미리보기: an invite link (/j?join=ABCD&g=seotda&t=gold-room&r=CODE, or just
// /j?r=CODE) gets the app page with its own title, line and picture, so a friend sees who invited
// them to what before tapping. worker/index.mjs and server.mjs serve it; the plain page keeps the
// default tags written in public/index.html.
import { FLOORS } from './constants.mjs';
import { INVITE_REWARD } from './referral.mjs';

const GAMES = { holdem: '홀덤', seotda: '섯다', gostop: '고스톱', matgo: '맞고', blackjack: '블랙잭' };
const eok = n => `${Math.round(n / 100_000_000).toLocaleString('ko-KR')}억`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function previewFor({ inviter, game, tier, code }, origin) {
  const g = GAMES[game] ? game : null;
  const floor = FLOORS.find(f => f.slug === tier);
  const room = g && /^[A-Z0-9]{4}$/.test(String(code || ''));
  const who = inviter ? `${inviter}님이` : '친구가';
  const title = room ? `${who} ${GAMES[g]} 방에 초대했어요` : `${who} VEGAS에 초대했어요`;
  const where = room ? `방 코드 ${code}${floor ? ` · ${floor.name}` : ''}. ` : '';
  const description = `${where}가입 없이 바로 앉아요. 첫 판을 끝내면 둘 다 ${eok(INVITE_REWARD)} 칩. 현금 가치 없는 가상 칩이에요.`;
  return { title, description, image: `${origin}/og/${g || 'vegas'}.jpg`, pageTitle: `${title} · VEGAS` };
}

// Swaps the default tags in public/index.html for the preview and roots relative links at /.
export function injectPreview(html, p, pageUrl) {
  const set = (prop, value, attr = 'property') => {
    html = html.replace(new RegExp(`(<meta ${attr}="${prop}" content=")[^"]*(")`), `$1${esc(value)}$2`);
  };
  set('og:title', p.title);
  set('og:description', p.description);
  set('og:image', p.image);
  set('og:url', pageUrl);
  set('twitter:title', p.title, 'name');
  set('twitter:description', p.description, 'name');
  set('twitter:image', p.image, 'name');
  set('description', p.description, 'name');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(p.pageTitle)}</title>`);
  return html.replace('<head>', '<head>\n  <base href="/">');
}

export const isInvitePath = pathname => pathname === '/j' || pathname === '/j/';
