// Screenshots of app screens for docs/screenshots (headless Chromium via Playwright).
// The app must be running (npm run build && npm start, or npm run dev).
// Usage: node scripts/screenshot.mjs <name> <path> [email]      e.g.
//        node scripts/screenshot.mjs 6-artists /admin/artists admin@royalty.test
// Saves docs/screenshots/<name>.png. With an e-mail it logs in first (demo password).
import { chromium } from 'playwright';

const [name, path, email] = process.argv.slice(2);
if (!name || !path) {
  console.error('usage: node scripts/screenshot.mjs <name> <path> [email]');
  process.exit(1);
}
const base = process.env.APP_URL || 'http://localhost:3000';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
if (email) {
  const res = await page.request.post(`${base}/api/auth/login`, { data: { email, password: 'Password@123' } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
}
await page.goto(base + path, { waitUntil: 'load' });
await page.waitForTimeout(800);   // let client components fetch their data
await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });
await browser.close();
console.log(`saved docs/screenshots/${name}.png`);
