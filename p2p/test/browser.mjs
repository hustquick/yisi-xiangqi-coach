import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [];
try {
  const a = await browser.newPage(), b = await browser.newPage();
  await a.addInitScript(() => { const Original = window.RTCPeerConnection; window.__testPeers = []; window.RTCPeerConnection = class extends Original { constructor(...args) { super(...args); window.__testPeers.push(this); } }; });
  for (const page of [a, b]) page.on('pageerror', e => errors.push(e.message));
  const stamp = Date.now();
  for (const [page, suffix] of [[a, 'a'], [b, 'b']]) {
    await page.goto(process.env.P2P_TEST_PAGE ?? 'http://localhost:8080');
    assert.equal(await page.getByLabel('连接服务', { exact: true }).count(), 0, '用户界面不暴露服务器设置');
    await page.getByLabel('网络账号', { exact: true }).fill(`test${stamp}${suffix}`);
    await page.getByLabel('网络密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '注册并上线', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已登录' }).waitFor();
  }
  await a.getByRole('button', { name: `邀请 test${stamp}b`, exact: true }).click();
  await b.getByRole('button', { name: '接受', exact: true }).click();
  for (const page of [a, b]) await page.getByRole('status').filter({ hasText: '双方局面一致' }).waitFor({ timeout: 30000 });
  async function move(page, label, to) {
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await page.getByRole('button', { name: `棋盘 ${to}`, exact: true }).click({ force: true });
  }
  const red = page => page.getByRole('button', { name: '红兵', exact: true }).first();
  await move(a, '红兵', '0,5');
  await b.waitForFunction(() => document.querySelector('.piece.red[aria-label="红兵"]')?.getAttribute('style')?.includes('55.555'));
  const after = await red(a).getAttribute('style');
  await a.getByRole('button', { name: '重开', exact: true }).click();
  assert.equal(await red(a).getAttribute('style'), after, '联网禁止单方重开');
  await move(b, '黑卒', '0,4');
  await a.waitForFunction(() => document.querySelector('.piece.black[aria-label="黑卒"]')?.getAttribute('style')?.includes('44.444'));
  await a.screenshot({ path: '/tmp/yisi-p2p-network-a.png', fullPage: true });
  await a.evaluate(() => window.__testPeers.at(-1).close());
  await a.getByRole('button', { name: '重连并核对局面', exact: true }).waitFor();
  await a.getByRole('button', { name: '重连并核对局面', exact: true }).click();
  for (const page of [a, b]) await page.getByRole('status').filter({ hasText: '双方局面一致' }).waitFor({ timeout: 30000 });
  assert.equal(await red(a).getAttribute('style'), after, '重连保留局面');
  await a.getByRole('button', { name: '退出对局', exact: true }).click();
  await b.getByRole('status').filter({ hasText: '对局已结束' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS cloud registration + invitation + real WebRTC + two legal moves + reset lock + reconnect + leave');
} finally { await browser.close(); }
