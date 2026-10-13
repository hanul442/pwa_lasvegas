// Turns the key art SVGs (scripts/art.mjs) into the WebP pictures the app shows. The SVGs are
// drawn with soft shadows and blur filters, which a phone has to re-render for every screen tile
// as the lobby scrolls; a flat picture is drawn once and only copied after that. Rendered at 2×
// (960×720) so they stay sharp on a large phone screen. Run after `node scripts/art.mjs`.
// Needs Playwright's Chromium (PLAYWRIGHT_BROWSERS_PATH or CHROMIUM) and ImageMagick (`convert`).
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const dir = new URL('../public/art/', import.meta.url).pathname;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 480, height: 360 }, deviceScaleFactor: 2 });
for (const file of readdirSync(dir).filter(f => f.endsWith('.svg'))) {
  const svg = readFileSync(dir + file).toString('base64');
  await page.setContent(`<style>html,body{margin:0;background:#000}</style><img src="data:image/svg+xml;base64,${svg}" width="480" height="360" style="display:block">`);
  await page.locator('img').evaluate(img => img.decode());
  const png = dir + file.replace('.svg', '.tmp.png');
  await page.screenshot({ path: png });
  execFileSync('convert', [png, '-quality', '82', '-define', 'webp:method=6', dir + file.replace('.svg', '.webp')]);
  rmSync(png);
}
await browser.close();
