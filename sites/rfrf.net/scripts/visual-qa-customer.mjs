import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const directory = resolve('outputs/visual-review');
await mkdir(directory, { recursive: true });
const server = spawn(process.execPath, ['hostinger-runtime/bootstrap.cjs'], {
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3108', NODE_ENV: 'production' },
  stdio: 'ignore',
});
const report = { startedAtUtc: new Date().toISOString(), origin: 'http://127.0.0.1:3108', productionBuild: true, checks: [], screenshots: [], errors: [], passed: false };
let browser;

function check(name, ok) {
  report.checks.push({ name, ok: Boolean(ok) });
  if (!ok) throw new Error(name);
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(report.origin, { signal: AbortSignal.timeout(1000) });
      ready = response.ok;
      await response.body?.cancel();
      if (ready) break;
    } catch { /* The owned preview server is starting. */ }
    await pause(1000);
  }
  check('production preview starts', ready);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const [device, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', locale: 'ar-SA' });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push({ device, message: error.message }));
    for (const [name, path] of [['home', '/'], ['companies', '/companies'], ['login', '/login']]) {
      const response = await page.goto(report.origin + path, { waitUntil: 'networkidle', timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      check(`${device} ${name} HTTP200`, response?.status() === 200);
      check(`${device} ${name} RTL`, await page.locator('html').getAttribute('dir') === 'rtl');
      check(`${device} ${name} width`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check(`${device} ${name} heading`, await page.locator('h1').count() === 1);
      if (name === 'home') {
        check(`${device} companies entry visible`, await page.getByRole('link', { name: 'شركات قطع الغيار', exact: true }).first().count() > 0);
        check(`${device} contact visible in source`, await page.locator('a[href="tel:+966500894003"]').count() > 0);
      }
      if (name === 'companies') {
        await page.getByRole('button', { name: 'معدات', exact: true }).click();
        check(`${device} equipment filter`, (await page.getByRole('status').innerText()).includes('1'));
        await page.getByRole('searchbox').fill('غيرموجود123');
        check(`${device} empty state`, await page.getByRole('heading', { name: 'لم نجد شركة بهذا البحث' }).isVisible());
        await page.getByRole('button', { name: 'عرض كل الشركات' }).click();
        check(`${device} reset search`, (await page.getByRole('status').innerText()).includes('4'));
        await page.getByRole('searchbox').fill('volvo');
        check(`${device} Latin brand search`, (await page.getByRole('status').innerText()).includes('1'));
        await page.getByRole('button', { name: 'مسح البحث' }).click();
        check(`${device} restore results`, (await page.getByRole('status').innerText()).includes('4'));
      }
      const filename = `${device}-${name}.png`;
      await page.screenshot({ path: resolve(directory, filename), fullPage: true, animations: 'disabled' });
      report.screenshots.push(filename);
    }
    await context.close();
  }
  check('no uncaught browser errors', report.errors.length === 0);
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  report.finishedAtUtc = new Date().toISOString();
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
