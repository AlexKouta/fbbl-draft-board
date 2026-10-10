// Browser checks from the PRD, run headless against a local server.
// Usage: node tests/browser_checks.mjs [baseUrl]   (default http://127.0.0.1:8765/)
// Needs Playwright: set PLAYWRIGHT_MODULE to a playwright package dir and, if the bundled
// browser build is missing, CHROME_PATH to a Chromium / headless shell binary.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const PW = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(PW.startsWith('/') ? pathToFileURL(path.join(PW, 'index.mjs')).href : PW);
const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const SHOTS = process.env.SHOTS_DIR || path.join(process.cwd(), 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const browser = await chromium.launch(launchOpts);

for (const [w, h] of [[1180, 820], [820, 1180]]) {
  console.log(`\n=== Viewport ${w}x${h} ===`);
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: false });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  const col = async (cls) => page.$$eval(`#rows tr:not(.group-row) td.${cls}`, els => els.map(e => e.textContent.trim()));
  const firstName = async () => page.$eval('#rows tr .pname', e => e.textContent.trim().replace(/[▲✎]|DTD|OUT|Q$/g, '').trim());
  const rowCount = async () => page.$$eval('#rows tr:not(.group-row)', els => els.length);
  const countText = async () => page.$eval('#count', e => e.textContent);
  const fppgOf = async (name) => page.$eval(`#rows tr:has(.pname:has-text("${name}")) td.col-fppg`, e => e.textContent.trim());

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.waitForTimeout(300);

  await check('loads with no console errors and shows the pool sorted by projected FPPG', async () => {
    assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
    eq(await firstName(), 'Nikola Jokic');
    const f = (await col('col-fppg')).map(Number);
    for (let i = 1; i < f.length; i++) if (!Number.isNaN(f[i]) && !Number.isNaN(f[i - 1])) assert(f[i] <= f[i - 1], `not sorted desc at ${i}`);
    eq(await page.$eval('#rows tr td.col-fppg', e => e.textContent.trim()), '42.6');
    eq(await page.$eval('.mode-btn.active', e => e.dataset.mode), 'prep');
  });
  await page.screenshot({ path: path.join(SHOTS, `players-${w}x${h}.png`) });

  await check('switching stat source changes FPPG, FP, GP, MPG and re-sorts', async () => {
    const before = { fppg: await fppgOf('Nikola Jokic'), gp: await page.$eval('#rows tr td.col-gp', e => e.textContent.trim()), mpg: await page.$eval('#rows tr td.col-mpg', e => e.textContent.trim()) };
    await page.click('[data-source="last"]');
    await page.waitForTimeout(100);
    const jokicLast = await fppgOf('Nikola Jokic');
    eq(jokicLast, '42.4', 'Jokic last-season fppg');
    assert(jokicLast !== before.fppg, 'fppg unchanged');
    const gp = await page.$eval('#rows tr:has(.pname:has-text("Nikola Jokic")) td.col-gp', e => e.textContent.trim());
    eq(gp, '65', 'Jokic last-season gp');
    // Haliburton missed last season: dash and sorts last under last-season source
    const names = await page.$$eval('#rows tr .pname', els => els.map(e => e.textContent));
    const hal = names.findIndex(n => n.includes('Haliburton'));
    assert(hal > names.length - 40, 'Haliburton should sort near the end with zero games');
    const halF = await fppgOf('Tyrese Haliburton');
    eq(halF, '–', 'zero-game dash');
    await page.click('[data-source="proj"]');
    await page.waitForTimeout(100);
    eq(await fppgOf('Nikola Jokic'), '42.6');
  });

  await check('search ignores case and accents, clear button resets', async () => {
    await page.fill('#search', 'JOKIĆ');
    await page.waitForTimeout(100);
    eq(await rowCount(), 1);
    eq(await firstName(), 'Nikola Jokic');
    await page.click('#search-clear');
    await page.waitForTimeout(100);
    eq(await page.$eval('#search', e => e.value), '');
    assert((await rowCount()) > 200, 'rows restored');
  });

  await check('each filter works alone and combined; clear filters resets all', async () => {
    const total = await rowCount();
    await page.click('[data-tier="S"]');
    eq(await rowCount(), 5, 'tier S');
    await page.click('[data-tier="A"]');
    eq(await rowCount(), 13, 'tier S+A');
    await page.click('[data-tier="S"]'); await page.click('[data-tier="A"]');
    eq(await rowCount(), total, 'tiers cleared');
    await page.click('[data-pos="C"]');
    const cCount = await rowCount();
    assert(cCount > 20 && cCount < total, 'position C');
    const pos = await col('col-pos');
    assert(pos.every(x => x.split('/').includes('C')), 'every row eligible at C');
    await page.selectOption('#team-select', 'DEN');
    const denC = await rowCount();
    assert(denC >= 1 && denC < cCount, 'DEN centres');
    assert((await col('col-team')).every(t => t === 'DEN'), 'all DEN');
    await page.click('[data-tier="S"]');
    eq(await rowCount(), 1, 'S + C + DEN = Jokic');
    await page.click('#uptick-toggle');
    eq(await rowCount(), 0, 'no upticks set yet');
    assert(!(await page.$eval('#empty', e => e.hidden)), 'empty message shown');
    await page.click('#clear-filters');
    eq(await rowCount(), total, 'clear filters');
    eq(await page.$$eval('.chip.on', e => e.length), 0, 'no chips on');
    eq(await page.$eval('#team-select', e => e.value), '');
    await page.click('#group-toggle');
    assert((await page.$$eval('#rows tr.group-row', e => e.length)) === 7, 'seven tier group rows');
    await page.click('#group-toggle');
  });

  await check('column header sorts on tap and reverses on second tap', async () => {
    await page.click('th[data-sort="adp"]');
    const adp = (await col('col-adp')).map(Number).filter(n => !Number.isNaN(n));
    for (let i = 1; i < adp.length; i++) assert(adp[i] >= adp[i - 1], 'adp asc');
    await page.click('th[data-sort="adp"]');
    const adp2 = (await col('col-adp')).map(Number).filter(n => !Number.isNaN(n));
    for (let i = 1; i < adp2.length; i++) assert(adp2[i] <= adp2[i - 1], 'adp desc');
    await page.click('th[data-sort="fppg"]');
    eq(await firstName(), 'Nikola Jokic');
  });

  await check('prep pass: tier, uptick, note, target 45 → R5, persist across reload', async () => {
    await page.click('#rows tr:has(.pname:has-text("Jalen Johnson")) .pname');
    await page.waitForSelector('.modal');
    await page.click('.modal #sheet-tiers [data-tier="S"]');
    await page.click('.modal #sheet-uptick');
    await page.fill('.modal #sheet-target', '45');
    eq(await page.$eval('#sheet-round', e => e.textContent), 'R5');
    await page.fill('.modal #sheet-note', 'Breakout candidate');
    await page.click('.modal [data-x="close"]');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#loading', { state: 'hidden' });
    const row = page.locator('#rows tr:has(.pname:has-text("Jalen Johnson"))');
    eq(await row.locator('td.col-tier').innerText(), 'S');
    assert(await row.locator('.mark-up').count() === 1, 'uptick marker');
    assert(await row.locator('.mark-note').count() === 1, 'note marker');
    eq(await row.locator('td.col-target').innerText(), '45 · R5');
    await page.click('[data-tier="S"]');
    eq(await rowCount(), 6, 'tier S now has six');
    await page.click('#clear-filters');
    // Quick tier picker from the chip
    await page.click('#rows tr:has(.pname:has-text("Jalen Johnson")) .tier');
    await page.waitForSelector('.modal .tier-pick');
    await page.click('.modal .tier-pick [data-tier="A"]');
    eq(await row.locator('td.col-tier').innerText(), 'A');
  });

  await check('draft pass: picks, status bar, My Team, Picks, undo, correct, reload', async () => {
    await page.click('[data-mode="draft"]');
    eq(await page.$eval('.seg-btn.active[data-status]', e => e.dataset.status), 'available', 'draft mode defaults to Available');
    assert(!(await page.$eval('#draftbar', e => e.hidden)), 'status bar visible');
    eq(await page.$eval('#db-current', e => e.textContent), 'Pick 1 · Round 1');
    assert(!(await page.$eval('#db-slot-btn', e => e.hidden)), 'slot prompt shown');
    // set slot 3 via settings
    await page.click('#db-slot-btn');
    await page.selectOption('#set-slot', '3');
    await page.click('[data-view="players"]');
    assert((await page.$eval('#db-next', e => e.textContent)).includes('Your next pick: 3 (Round 1), in 2 picks'), 'next pick text');
    const total = await rowCount();
    // pick 1: other
    await page.click('#rows tr:has(.pname:has-text("Nikola Jokic")) .draft-btn');
    await page.waitForSelector('.modal');
    assert((await page.$eval('.modal .sub', e => e.textContent)).includes('Pick 1 · Round 1'), 'modal shows pick number');
    await page.click('.modal [data-by="other"]');
    eq(await rowCount(), total - 1, 'Jokic left Available');
    eq(await page.$eval('#db-current', e => e.textContent), 'Pick 2 · Round 2'.replace('Round 2', 'Round 1'));
    // pick 2: other via row tap
    await page.click('#rows tr:has(.pname:has-text("Giannis")) td.col-team');
    await page.click('.modal [data-by="other"]');
    assert((await page.$eval('#draftbar', e => e.className)).includes('your-pick'), 'your pick state at pick 3');
    // pick 3: mine
    await page.click('#rows tr:has(.pname:has-text("Luka Doncic")) .draft-btn');
    await page.click('.modal [data-by="me"]');
    eq(await rowCount(), total - 3);
    eq(await page.$eval('#team-badge', e => e.textContent), '1');
    eq(await page.$eval('#picks-badge', e => e.textContent), '3');
    // Taken filter shows them with pick numbers
    await page.click('[data-status="taken"]');
    eq(await rowCount(), 3);
    assert((await page.locator('#rows tr.mine').count()) === 1, 'one mine row');
    assert((await page.locator('#rows tr.taken').count()) === 2, 'two taken rows');
    eq(await page.locator('#rows tr.mine .pick-num').innerText(), '#3');
    await page.click('[data-status="available"]');
    // My Team
    await page.click('[data-view="team"]');
    assert((await page.textContent('#team-page')).includes('1 of 13'), 'roster count');
    assert((await page.textContent('#team-page')).includes('Luka Doncic'), 'Luka on team');
    assert((await page.textContent('#team-page')).includes('36.1'), 'starters fppg');
    await page.screenshot({ path: path.join(SHOTS, `team-${w}x${h}.png`) });
    // Picks
    await page.click('[data-view="picks"]');
    eq(await page.$$eval('.picklog tr', e => e.length), 3);
    await page.screenshot({ path: path.join(SHOTS, `picks-${w}x${h}.png`) });
    // Undo
    await page.click('#db-undo');
    eq(await page.$$eval('.picklog tr', e => e.length), 2);
    assert((await page.textContent('#toast')).includes('Undid pick 3: Luka Doncic'), 'undo toast');
    // Correct: switch pick 2 to me, then return pick 1 to available
    await page.click('.picklog tr:nth-child(2)');
    await page.click('.modal [data-by="me"]');
    eq(await page.locator('.picklog tr:nth-child(2) td.who').innerText(), 'Me');
    await page.click('.picklog tr:nth-child(1)');
    await page.click('.modal [data-x="return"]');
    eq(await page.$$eval('.picklog tr', e => e.length), 1);
    eq(await page.locator('.picklog tr:nth-child(1) td.n').innerText(), '1', 'renumbered');
    assert((await page.textContent('.picklog')).includes('Giannis'), 'Giannis is now pick 1');
    // Reload with state intact
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#loading', { state: 'hidden' });
    eq(await page.$eval('.mode-btn.active', e => e.dataset.mode), 'draft', 'mode survives reload');
    eq(await page.$eval('.tab.active', e => e.dataset.view), 'picks', 'view survives reload');
    eq(await page.$$eval('.picklog tr', e => e.length), 1);
    eq(await page.$eval('#db-current', e => e.textContent), 'Pick 2 · Round 1');
    await page.click('[data-view="players"]');
    await page.screenshot({ path: path.join(SHOTS, `draft-${w}x${h}.png`) });
    // Read-only sheet in draft mode
    await page.click('#rows tr:has(.pname:has-text("Jalen Johnson")) .pname');
    assert((await page.textContent('.modal h3')).includes('read only'), 'read-only sheet');
    assert(await page.$eval('.modal #sheet-note', e => e.disabled), 'note disabled');
    await page.click('.modal [data-x="close"]');
    // Target cue: next pick is 3 (slot 3, one pick made). Target 45 is later, so no cue; target 3 is at the next pick, so cue.
    assert(!(await page.locator('#rows tr:has(.pname:has-text("Jalen Johnson"))').getAttribute('class')).includes('target-cue'), 'no cue for a later target');
    await page.evaluate(() => { const s = window.__app.state; const p = window.__app.data.players.find(x => x.name === 'Jalen Johnson'); s.players[p.id].target = 3; window.__app.save(); window.__app.renderAll(); });
    assert((await page.locator('#rows tr:has(.pname:has-text("Jalen Johnson"))').getAttribute('class')).includes('target-cue'), 'target cue shown');
  });

  await check('export / reset draft / import round-trip', async () => {
    await page.click('[data-view="settings"]');
    await page.click('#export-btn');
    const json = await page.$eval('#export-text', e => e.value);
    assert(JSON.parse(json).picks.length === 1, 'export has picks');
    await page.click('#reset-draft');
    await page.click('.modal [data-x="ok"]');
    eq(await page.$eval('#picks-badge', e => e.textContent), '');
    await page.click('#import-btn');
    await page.fill('#import-text', json);
    await page.click('#import-apply');
    await page.click('.modal [data-x="ok"]');
    eq(await page.$eval('#picks-badge', e => e.textContent), '1', 'picks back after import');
    await page.screenshot({ path: path.join(SHOTS, `settings-${w}x${h}.png`) });
  });

  await check('offline reload still opens the app with data', async () => {
    // Wait for the service worker to be active and have precached the assets
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#loading', { state: 'hidden' });
    await page.click('[data-view="players"]');
    await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; if (!r.active) throw new Error('no active sw'); });
    await page.waitForTimeout(800);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 8000 });
    assert(await page.$('#loading'), 'app page loaded (not an error page)');
    assert((await rowCount()) > 200, 'rows rendered offline');
    eq(await firstName(), 'Nikola Jokic');
    await context.setOffline(false);
  });

  await check('no console errors during the run', async () => {
    const real = errors.filter(e => !/favicon|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
    assert(real.length === 0, real.join(' | '));
  });

  await context.close();
}

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
