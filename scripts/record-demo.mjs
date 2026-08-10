/**
 * Records the README demo GIF against `turnlog demo`, so the reel shows the
 * current UI instead of whatever the last hand-made recording caught.
 *
 * Playwright and ffmpeg are NOT dependencies — this runs a few times a year,
 * and a 95MB browser download does not belong in the install of a tool whose
 * whole runtime is two packages. Install them where you run it:
 *
 *   npm i playwright && npx playwright install chromium   # in a scratch dir
 *   brew install ffmpeg
 *
 *   node bin/turnlog.cjs demo --port 7788 --no-open       # copy the token
 *   TURNLOG_URL='http://127.0.0.1:7788/?token=…' node scripts/record-demo.mjs
 *   ffmpeg -y -ss 2.2 -t 12.4 -i video/*.webm \
 *     -vf "fps=12,scale=1000:-1:flags=lanczos,split[a][b];\
 *          [a]palettegen=stats_mode=diff:max_colors=128[p];\
 *          [b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" demo.gif
 *
 * The GIF is served from turnlog.dev/media/, not committed here: npm ignores
 * relative image paths in a README, so the URL has to be absolute anyway, and
 * hosting it keeps 2MB out of every install.
 */
import { chromium } from 'playwright';

const URL = process.env.TURNLOG_URL;
if (!URL) throw new Error('set TURNLOG_URL to the demo server URL (token included)');
const SIZE = { width: 1440, height: 900 };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: SIZE,
  recordVideo: { dir: 'video', size: SIZE },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

// Never waitForLoadState('networkidle') here: the status poll and the live
// event stream mean this page is never idle, so it would wait forever.
await page.goto(URL);
await page.waitForTimeout(3000);
// The demo banner is honest, but it is not the product.
await page.addStyleTag({ content: '.demo-banner,[class*="demo"]{display:none !important}' });
await page.waitForTimeout(1200);

const hero = page.locator('input[placeholder*="grep"]');
await hero.click();
await page.waitForTimeout(400);
await hero.type('reconnect', { delay: 110 });
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.waitForTimeout(2600);

// The point of the reel: a hit is a place in a conversation, not a filename.
await page.locator('text=/Fix the/').first().click();
await page.waitForTimeout(3000);
await page.mouse.wheel(0, 320);
await page.waitForTimeout(1800);

await ctx.close();
await browser.close();
console.log('recorded to video/');
