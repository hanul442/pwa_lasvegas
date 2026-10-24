// Draws the link-preview pictures in public/og (1200×630, 카카오톡·문자). Run: node scripts/og-images.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { readFile } = require('node:fs/promises');
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const logo = await readFile(`${root}/public/logo.svg`, 'utf8');
const cards = [
  ['vegas', 'blackjack', '친구들과 한 판', '블랙잭 · 홀덤 · 섯다 · 고스톱', 'SOCIAL CASINO'],
  ['holdem', 'poker', '홀덤 한 판 하자', "텍사스 홀덤 · 친구 방", "HOLD'EM"],
  ['seotda', 'seotda', '섯다 한 판 하자', '두 장으로 겨루는 족보 싸움', 'SEOTDA'],
  ['gostop', 'gostop', '고스톱 한 판 하자', '셋이서 치는 고·스톱', 'GO-STOP'],
  ['matgo', 'matgo', '맞고 한 판 하자', '둘이서 치는 고스톱', 'MATGO'],
  ['blackjack', 'blackjack', '블랙잭 한 판 하자', '21에 가깝게, 블랙잭은 3 대 2', 'BLACKJACK'],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [out, art, head, sub, kicker] of cards) {
  const img = (await readFile(`${root}/public/art/${art}.webp`)).toString('base64');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=Noto+Sans+KR:wght@500;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#0a0b0d;color:#f4f5f7;font-family:'Noto Sans KR',sans-serif;overflow:hidden;position:relative}
.art{position:absolute;right:0;top:0;width:700px;height:630px;background:url(data:image/webp;base64,${img}) center/cover;}
.art:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#0a0b0d 0%,rgba(10,11,13,.85) 22%,rgba(10,11,13,.15) 60%,rgba(10,11,13,0) 100%)}
.text{position:absolute;left:72px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center}
.logo svg{width:250px;height:auto;display:block}
.kicker{font-family:Archivo;font-stretch:125%;font-weight:700;letter-spacing:.22em;font-size:18px;color:#9aa0a8;margin:44px 0 14px}
h1{font-size:68px;font-weight:900;letter-spacing:-.02em;line-height:1.08}
p{font-size:28px;color:#c9ccd1;margin-top:18px;font-weight:500}
.pill{margin-top:40px;display:inline-flex;align-self:flex-start;align-items:center;gap:12px;background:#f4f5f7;color:#0a0b0d;font-weight:700;font-size:24px;padding:16px 28px;border-radius:999px}
.fine{position:absolute;left:72px;bottom:34px;font-size:16px;color:#6b7078}
.rule{position:absolute;left:0;right:0;bottom:0;height:6px;background:linear-gradient(90deg,#f4f5f7 0 30%,transparent 30%)}
</style></head><body>
<div class="art"></div>
<div class="text"><div class="logo">${logo}</div><div class="kicker">${kicker}</div><h1>${head}</h1><p>${sub}</p><span class="pill">가입 없이 바로 앉기 →</span></div>
<div class="fine">현금 가치 없는 가상 칩 · 만 19세 이상</div>
</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${root}/public/og/${out}.jpg`, type: 'jpeg', quality: 86 });
}
await browser.close();
