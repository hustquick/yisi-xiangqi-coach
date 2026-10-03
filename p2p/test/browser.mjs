import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: process.env.P2P_TEST_ENDPOINT ? ['--disable-features=LocalNetworkAccessChecks'] : [] });
const errors = [];
try {
  const a = await browser.newPage(), b = await browser.newPage(), c=await browser.newPage();
  if(process.env.P2P_TEST_ENDPOINT) for(const page of [a,b,c]) await page.route(process.env.P2P_TEST_PAGE ?? 'http://localhost:8080',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('content="https://141.148.168.171"',`content="${process.env.P2P_TEST_ENDPOINT}"`)});
  });
  for (const page of [a, b, c]) await page.addInitScript(relay => {
    const Original = window.RTCPeerConnection; window.__testPeers = [];
    const originalFetch = window.fetch;
    window.fetch = async (url, options) => {
      if (String(url).endsWith('/events')) {
        const controller = new AbortController();
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        window.__cutEvents = () => controller.abort();
        while(window.__pauseEvents) {if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');await new Promise(r=>setTimeout(r,50));}
        return originalFetch(url, { ...options, signal: controller.signal });
      }
      return originalFetch(url, options);
    };
    window.RTCPeerConnection = class extends Original {
      constructor(config, ...args) {
        super(relay ? { ...config, iceTransportPolicy: 'relay' } : config, ...args);
        window.__testPeers.push(this);
      }
    };
  }, process.env.P2P_TEST_RELAY === '1');
  for (const page of [a, b, c]) page.on('pageerror', e => errors.push(e.message));
  if(process.env.P2P_TEST_DEBUG) for(const page of [a,b,c]) {
    page.on('console',message=>{if(message.type()==='error')console.log(message.text());});
    page.on('response',async response=>{if(response.status()>=400 || response.url().endsWith('/watch/selection')) console.log(new URL(response.url()).pathname,response.status(),await response.text());});
    page.on('requestfailed',request=>console.log('failed',new URL(request.url()).pathname,request.failure()));
  }
  const stamp = Date.now();
  for (const [page, suffix] of [[a, 'a'], [b, 'b'],[c,'c']]) {
    await page.goto(process.env.P2P_TEST_PAGE ?? 'http://localhost:8080',{waitUntil:'domcontentloaded'});
    assert.equal(await page.getByLabel('连接服务', { exact: true }).count(), 0, '用户界面不暴露服务器设置');
    assert.equal(await page.getByLabel('确认密码', { exact: true }).count(), 0, '登录不显示确认密码');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByLabel('网络账号', { exact: true }).fill(`test${stamp}${suffix}`);
    await page.getByLabel('网络密码', { exact: true }).fill('1');
    await page.getByLabel('确认密码', { exact: true }).fill('2');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '两次输入的密码不一致' }).waitFor();
    await page.getByLabel('确认密码', { exact: true }).fill('1');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByRole('combobox', { name: '账户状态', exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'账户状态',exact:true}).inputValue(),'online','注册直接登录在线');
    await page.getByRole('combobox', { name: '账户状态', exact: true }).selectOption('logout');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    assert.equal(await page.getByLabel('确认密码', { exact: true }).count(), 0);
    await page.getByLabel('网络密码', { exact: true }).fill('1');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('combobox', { name: '账户状态', exact: true }).waitFor();
  }
  assert.equal(await b.getByRole('button', { name: '账户信息', exact: true }).count(), 0);
  assert.equal(await b.getByRole('button', { name: '恢复在线', exact: true }).count(), 0);
  assert.equal(await b.getByRole('button', { name: '好友列表', exact: true }).count(), 1);
  await a.getByText('棋谱与存档', { exact: true }).click();
  await a.getByRole('button', { name: '保存到云端', exact: true }).click();
  const records = a.getByRole('region', { name: '我的云端棋谱' });
  await records.getByRole('button', { name: '载入', exact: true }).waitFor();
  const download = a.waitForEvent('download');
  await records.getByRole('button', { name: '下载', exact: true }).click();
  assert.equal((await download).suggestedFilename(), '象棋棋谱.json');
  await records.getByRole('button', { name: '载入', exact: true }).click();
  await a.getByRole('status').filter({ hasText: '已载入' }).waitFor();
  await b.getByText('棋谱与存档', { exact: true }).click();
  await b.getByRole('button', { name: '我的云端棋谱', exact: true }).click();
  await b.getByText('暂无云端棋谱', { exact: true }).waitFor();
  await a.getByRole('button', { name: /^好友列表/ }).click();
  await a.getByLabel('搜索好友账号', { exact: true }).fill(`test${stamp}b`);
  await a.getByRole('button', { name: '搜索', exact: true }).click();
  await a.getByRole('button', { name: '添加好友', exact: true }).click();
  await b.getByRole('button',{name:'同意好友申请',exact:true}).click();
  const friendRow = a.locator(`[data-friend="test${stamp}b"]`);
  assert.equal(await a.getByLabel('每方局时',{exact:true}).inputValue(),'15');
  const heights=await a.locator('[aria-label="邀请对战设置"] select').evaluateAll(items=>items.map(el=>el.getBoundingClientRect().height));
  assert.equal(heights.length,3);assert.ok(heights.every(h=>h===40),'三个选择框等高');
  await friendRow.locator('span').filter({hasText:'在线'}).waitFor();
  await friendRow.getByRole('button', { name: '好友信息', exact: true }).click();
  await friendRow.getByText(`好友账号：test${stamp}b`, { exact: true }).waitFor();
  await b.getByRole('combobox', { name: '账户状态', exact: true }).selectOption('invisible');
  await friendRow.locator('span').filter({hasText:'离线'}).waitFor();
  assert.equal(await friendRow.getByRole('button', { name: '邀请对战', exact: true }).isDisabled(), true);
  await b.getByRole('combobox', { name: '账户状态', exact: true }).selectOption('online');
  await friendRow.locator('span').filter({hasText:'在线'}).waitFor();
  await b.getByRole('combobox', { name: '账户状态', exact: true }).selectOption('logout');
  await friendRow.locator('span').filter({hasText:'离线'}).waitFor();
  assert.equal(await friendRow.getByRole('button', { name: '邀请对战', exact: true }).isDisabled(), true);
  await b.getByLabel('网络密码', { exact: true }).fill('1');
  await b.getByRole('button', { name: '登录', exact: true }).click();
  await friendRow.locator('span').filter({hasText:'在线'}).waitFor();
  await friendRow.getByRole('button', { name: '邀请对战', exact: true }).click();
  await a.getByRole('status').filter({ hasText: '邀请已发出，等待对手接受' }).waitFor();
  await friendRow.getByRole('button', { name: '邀请对战', exact: true }).click();
  await a.getByRole('status').filter({ hasText: '邀请已发出，请等待对手回应' }).waitFor();
  if(process.env.P2P_TEST_QUICK!=='1') {
  await b.context().setOffline(true);
  await b.evaluate(() => window.__cutEvents());
  await b.getByRole('status').filter({ hasText: '正在恢复在线连接' }).waitFor();
  await b.context().setOffline(false);
  await a.getByRole('status').filter({ hasText: '邀请已失效' }).waitFor({ timeout: 80_000 });
  await friendRow.getByRole('button', { name: '邀请对战', exact: true }).click();
  }
  await b.getByRole('alert',{name:'对战邀请',exact:true}).waitFor();
  await b.waitForFunction(()=>document.activeElement?.textContent==='接受');
  assert.equal(await b.locator('.network-panel').evaluate(el=>el.open),true);
  await b.getByRole('button', { name: '接受', exact: true }).click();
  for (const page of [a, b]) await page.getByRole('status').filter({ hasText: '双方局面一致' }).waitFor({ timeout: 30000 });
  for(const page of [a,b]) {
    await page.waitForFunction(()=>document.activeElement===document.querySelector('.board'));
    await page.waitForFunction(()=>{const r=document.querySelector('.board').getBoundingClientRect();return Math.abs(r.top+r.height/2-innerHeight/2)<5;}).catch(async error=>{console.log(await page.locator('.board').evaluate(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height,viewport:innerHeight,scroll:scrollY})));await page.screenshot({path:'/tmp/yisi-focus-failed.png',fullPage:true});throw error;});
  }
  assert.equal(await a.getByRole('button',{name:'显示最优着法',exact:true}).isDisabled(),true);
  assert.equal(await a.getByText('教练分析',{exact:true}).count(),0);
  assert.equal(await a.getByText('局势图',{exact:true}).count(),0);
  assert.equal(await a.getByText('对弈与分析设置',{exact:true}).count(),0);
  await a.getByText('对局操作',{exact:true}).click();
  assert.equal(await a.getByRole('button',{name:'提和',exact:true}).count(),1);
  assert.equal(await a.getByRole('button',{name:'认输',exact:true}).count(),1);
  assert.ok(await b.getByRole('button',{name:'黑将',exact:true}).evaluate(el=>parseFloat(el.style.top)>90),'执黑时黑将在下方');
  if (process.env.P2P_TEST_RELAY === '1') {
    for (const page of [a, b]) assert.equal(await page.evaluate(async () => {
      const stats = await window.__testPeers.at(-1).getStats();
      for (const entry of stats.values()) if (entry.type === 'transport' && entry.selectedCandidatePairId) {
        const pair = stats.get(entry.selectedCandidatePairId);
        return stats.get(pair.localCandidateId)?.candidateType;
      }
    }), 'relay', '必须真实使用云端 TURN 中继');
  }
  async function move(page, label, to) {
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await page.getByRole('button', { name: `棋盘 ${to}`, exact: true }).click({ force: true });
  }
  await c.getByRole('button',{name:'好友列表',exact:true}).click();
  await c.getByLabel('搜索好友账号',{exact:true}).fill(`test${stamp}a`);
  await c.getByRole('button',{name:'搜索',exact:true}).click();
  await c.getByRole('button',{name:'添加好友',exact:true}).click();
  await a.getByRole('button',{name:'同意好友申请',exact:true}).click();
  await c.getByRole('button',{name:'观看对弈',exact:true}).click();
  await c.getByRole('button',{name:'退出观战',exact:true}).waitFor();
  await c.waitForFunction(()=>document.activeElement?.classList.contains('board'));
  await c.waitForFunction(()=>{
    const board=document.querySelector('.board').getBoundingClientRect();
    return Math.abs((board.top+board.bottom)/2-innerHeight/2)<30;
  });
  await c.getByRole('button',{name:'退出观战',exact:true}).focus();
  assert.equal(await c.getByRole('button',{name:'显示最优着法',exact:true}).isDisabled(),true);
  const red = page => page.getByRole('button', { name: '红兵', exact: true }).first();
  await a.getByRole('button',{name:'红兵',exact:true}).first().click();
  await b.locator('.piece.peer-selected').waitFor();
  const touchedStyle = await b.locator('.piece.peer-selected').evaluate(el => ({outline:getComputedStyle(el).outlineWidth,color:getComputedStyle(el).outlineColor,z:getComputedStyle(el).zIndex}));
  assert.equal(touchedStyle.outline,'4px');assert.equal(touchedStyle.color,'rgb(22, 136, 255)');assert.equal(touchedStyle.z,'8');
  assert.equal(await b.locator('.piece.peer-selected').getAttribute('aria-label'),'红兵','对方能看到摸子');
  await c.locator('.piece.peer-selected').waitFor();
  assert.equal(await c.locator('.record-message').count(),0,'观战自动载入不显示棋谱提示');
  assert.equal(await c.locator('header .status').count(),0,'观战不显示引擎计算状态');
  assert.equal(await c.locator('.record-toolbar').count(),0,'观战隐藏存档操作');
  assert.equal(await a.locator('header .status').count(),0,'网络对战不显示引擎计算状态');
  assert.equal(await c.locator('.piece.peer-selected').getAttribute('aria-label'),'红兵','观战者能看到摸子');
  const spectatorMoveStarted=Date.now();
  await a.getByRole('button',{name:'棋盘 0,5',exact:true}).click({force:true});
  await b.locator('.piece.peer-selected').waitFor({state:'detached'});
  await b.waitForFunction(() => document.querySelector('.piece.red[aria-label="红兵"]')?.getAttribute('style')?.includes('44.444'));
  await c.waitForFunction(() => document.querySelector('.piece.red[aria-label="红兵"]')?.getAttribute('style')?.includes('55.555'));
  assert.equal(await c.evaluate(()=>document.activeElement?.textContent),'退出观战','后续落子更新不抢走观战者焦点');
  assert.ok(Date.now()-spectatorMoveStarted<2000,'观战落子即时推送，不再叠加两轮轮询');
  await c.locator('.piece.peer-selected').waitFor({state:'detached'});
  assert.equal(await a.getByRole('button',{name:'黑卒',exact:true}).first().isDisabled(),true,'行棋后不能摸对方棋子');
  await a.getByRole('button',{name:'黑卒',exact:true}).first().dispatchEvent('click');
  assert.equal(await a.locator('.piece.selected').count(),0,'非己方回合不能选子');
  const watched=await c.getByRole('button',{name:'红兵',exact:true}).first().getAttribute('style');
  assert.equal(await c.getByRole('button',{name:'红兵',exact:true}).first().isDisabled(),true,'观战棋子只读');
  assert.equal(await c.getByRole('button',{name:'棋盘 0,4',exact:true}).isDisabled(),true,'观战落点只读');
  await c.getByRole('button',{name:'红兵',exact:true}).first().dispatchEvent('click');
  assert.equal(await c.locator('.piece.selected').count(),0,'观战者不能摸子');
  assert.equal(await c.getByRole('button',{name:'红兵',exact:true}).first().getAttribute('style'),watched,'观战者不能落子');
  const after = await red(a).getAttribute('style');
  assert.equal(await a.getByRole('button', { name: '重开', exact: true }).isDisabled(),true);
  assert.equal(await a.getByRole('button', { name: '悔棋', exact: true }).first().isDisabled(),true);
  assert.equal(await red(a).getAttribute('style'), after, '联网禁止单方重开');
  const blackClock=b.waitForResponse(response=>response.url().endsWith('/clock/move') && response.ok());
  await move(b, '黑卒', '0,4');await blackClock;
  await a.reload({waitUntil:'domcontentloaded'});
  await a.getByRole('combobox',{name:'账户状态',exact:true}).waitFor();
  await a.getByRole('status').filter({hasText:'对战已连接'}).waitFor();
  assert.equal(await red(a).getAttribute('style'),after,'刷新后保持登录并恢复原棋局');
  assert.equal(await a.getByRole('button',{name:'重开',exact:true}).isDisabled(),true,'刷新仍在原对局');
  await b.evaluate(()=>localStorage.removeItem('yisi-network-session'));
  await b.reload({waitUntil:'domcontentloaded'});
  await b.getByLabel('网络账号',{exact:true}).fill(`test${stamp}b`);
  await b.getByLabel('网络密码',{exact:true}).fill('1');
  await b.getByRole('button',{name:'登录',exact:true}).click();
  for(const page of [a,b]) await page.getByRole('status').filter({hasText:'对战已连接'}).waitFor();
  assert.equal(await red(a).getAttribute('style'),after,'重新登录恢复棋局不重开');
  const continued=a.waitForResponse(response=>response.url().endsWith('/clock/move') && response.ok());
  await move(a,'红兵','0,4');await continued;
  await b.waitForFunction(()=>document.querySelector('.piece.red[aria-label="红兵"]')?.getAttribute('style')?.includes('55.555'));
  assert.equal(await b.getByRole('button',{name:'黑卒',exact:true}).first().isDisabled(),false,'重新登录后可以继续轮到己方的棋步');
  const resumedMove=b.waitForResponse(response=>response.url().endsWith('/clock/move') && response.ok());
  await move(b,'黑卒','2,4');await resumedMove;
  await a.waitForFunction(()=>document.querySelector('.piece.black[aria-label="黑卒"]')?.getAttribute('style')?.includes('44.444'));
  const resumedPosition=await red(a).getAttribute('style');
  await a.getByText('对局操作',{exact:true}).click();
  for(const page of [a,b]) assert.equal(await page.getByRole('button',{name:'同意加时',exact:true}).count(),0,'未收到请求不显示同意按钮');
  await a.getByRole('button',{name:'申请加时',exact:true}).click();
  await b.waitForFunction(()=>document.activeElement?.textContent==='同意加时');
  assert.equal(await a.getByRole('button',{name:'同意加时',exact:true}).count(),0,'发起方不显示同意按钮');
  await b.getByRole('button',{name:'同意加时',exact:true}).click();
  await b.getByRole('button',{name:'同意加时',exact:true}).waitFor({state:'detached'});
  await a.getByRole('status').filter({hasText:'各加时5分钟'}).waitFor();
  await a.getByLabel('红方计时',{exact:true}).getByLabel('总剩余时间').filter({hasText:/19:/}).waitFor();
  await a.getByRole('button',{name:'悔棋',exact:true}).last().click();
  await b.waitForFunction(()=>document.activeElement?.textContent==='同意悔棋');
  await b.getByRole('button',{name:'拒绝悔棋',exact:true}).click();
  await a.getByRole('status').filter({hasText:'对方拒绝悔棋'}).waitFor();
  await a.getByRole('button',{name:'提和',exact:true}).click();
  await b.waitForFunction(()=>document.activeElement?.textContent==='同意和棋');
  await b.getByRole('button',{name:'拒绝和棋',exact:true}).click();
  await a.getByRole('status').filter({hasText:'对方拒绝提和'}).waitFor();
  await b.evaluate(()=>{window.__pauseEvents=true;window.__cutEvents();});
  await a.locator('.duel-operations [role="alert"]').filter({hasText:'对方已断线'}).waitFor();
  await b.evaluate(()=>{window.__pauseEvents=false;});
  await a.locator('.duel-operations [role="alert"]').filter({hasText:'对方已断线'}).waitFor({state:'detached'});
  await a.waitForFunction(() => document.querySelector('.piece.black[aria-label="黑卒"]')?.getAttribute('style')?.includes('44.444'));
  await a.screenshot({ path: '/tmp/yisi-p2p-network-a.png', fullPage: true });
  if (!process.env.P2P_TEST_QUICK) {
  await a.evaluate(() => window.__testPeers.at(-1).close());
  await a.getByRole('button', { name: '重连并核对局面', exact: true }).waitFor();
  await a.getByRole('button', { name: '重连并核对局面', exact: true }).click();
  for (const page of [a, b]) await page.getByRole('status').filter({ hasText: '双方局面一致' }).waitFor({ timeout: 30000 });
  assert.equal(await red(a).getAttribute('style'), resumedPosition, '重连保留局面');
  }
  await a.getByRole('button', { name: '退出对局', exact: true }).click();
  await b.getByRole('status').filter({ hasText: '对局已结束' }).waitFor();
  await b.getByRole('status').filter({hasText:'对方已退出'}).waitFor();
  await c.getByRole('status').filter({hasText:'已结束观战'}).waitFor();
  assert.equal(await c.locator('header .status').count(),1,'退出观战恢复引擎状态');
  assert.equal(await c.locator('.record-toolbar').count(),1,'退出观战恢复存档区');
  assert.equal(await b.getByRole('button',{name:'退出对局',exact:true}).count(),0,'对方退出后自动离开对战');
  await a.getByRole('button',{name:'对局历史',exact:true}).click();
  await a.getByRole('region',{name:'对局历史',exact:true}).getByText(/退出结束.*用时/).waitFor();
  await a.getByRole('button',{name:/^复盘分析/}).first().click();
  await a.getByRole('status').filter({hasText:'已载入'}).waitFor();
  await c.getByRole('combobox',{name:'账户状态',exact:true}).selectOption('logout');
  await c.getByLabel('网络账号',{exact:true}).fill(`test${stamp}a`);
  await c.getByLabel('网络密码',{exact:true}).fill('1');
  await c.getByRole('button',{name:'登录',exact:true}).click();
  await c.getByRole('combobox',{name:'账户状态',exact:true}).waitFor();
  await a.getByRole('status').filter({hasText:'账号已在其他设备登录，本端已退出'}).waitFor();
  assert.equal(await a.getByRole('combobox',{name:'账户状态',exact:true}).count(),0,'旧端自动退出登录');
  for(const page of [b,c]) {
    await page.getByLabel('每方局时',{exact:true}).selectOption('10');
    await page.getByRole('button',{name:'自动匹配',exact:true}).click();
  }
  for(const page of [b,c]) await page.getByRole('status').filter({hasText:'对战已连接'}).waitFor();
  const matchedRed=await red(b).isDisabled()?c:b;
  const matchedBlack=matchedRed===b?c:b;
  await move(matchedRed,'红兵','0,5');
  await matchedBlack.waitForFunction(()=>document.querySelector('.piece.red[aria-label="红兵"]')?.getAttribute('style')?.includes('44.444'));
  await move(matchedBlack,'黑卒','0,4');
  await matchedRed.waitForFunction(()=>document.querySelector('.piece.black[aria-label="黑卒"]')?.getAttribute('style')?.includes('44.444'));
  await matchedRed.getByText('对局操作',{exact:true}).click();
  await matchedRed.getByRole('button',{name:'提和',exact:true}).click();
  await matchedBlack.getByRole('button',{name:'同意和棋',exact:true}).click();
  for(const page of [matchedRed,matchedBlack]) await page.getByRole('button',{name:'再来一局',exact:true}).waitFor();
  await matchedRed.getByRole('button',{name:'再来一局',exact:true}).click();
  await matchedRed.waitForTimeout(1000);
  assert.equal(await matchedBlack.getByRole('button',{name:'再来一局',exact:true}).count(),1,'单方确认不得开始下一局');
  await matchedBlack.getByRole('button',{name:'再来一局',exact:true}).click();
  for(const page of [matchedRed,matchedBlack]) {
    await page.getByRole('button',{name:'再来一局',exact:true}).waitFor({state:'detached'});
    await page.getByRole('status').filter({hasText:'对战已连接'}).waitFor();
  }
  assert.equal(await red(matchedBlack).isDisabled(),false,'下一局交换执棋');
  if(!await matchedRed.getByRole('button',{name:'退出对局',exact:true}).isVisible()) await matchedRed.getByText('对局操作',{exact:true}).click();
  await matchedRed.getByRole('button',{name:'退出对局',exact:true}).click();
  await matchedBlack.getByRole('status').filter({hasText:'对方已退出'}).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS registration + invitation + real WebRTC + refresh + password re-login + continued moves + reconnect + leave');
} finally { await browser.close(); }
