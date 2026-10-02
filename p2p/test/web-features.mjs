import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.P2P_TEST_PAGE ?? 'https://141.148.168.171');
  await page.locator('.engine-ready').waitFor({ state: 'attached', timeout: 120000 });
  assert.equal(await page.getByRole('button', { name: '红兵', exact: true }).count(), 5);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, '手机宽度不应横向溢出');
  await page.getByText('对弈与分析设置', { exact: true }).click();
  await page.getByRole('button', { name: '人机对战', exact: true }).click();
  await page.getByRole('button', { name: '我执红', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('footer .moves')?.textContent?.includes('1.'));
  assert.deepEqual(errors, []);
  console.log('PASS mobile layout + browser engine analysis + computer opening move');
} finally { await browser.close(); }
