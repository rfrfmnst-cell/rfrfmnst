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
        check(`${device} companies entry visible`, await page.getByRole('link', { name: 'علامات المركبات', exact: true }).first().count() > 0);
        await page.getByRole('button', {name:'البحث برقم الهيكل VIN',exact:true}).click();
        check(`${device} homepage VIN control opens intake`, await page.getByLabel('رقم الهيكل (VIN)',{exact:true}).isVisible());
        await page.getByRole('button',{name:'إغلاق طريقة البحث',exact:true}).click();
        await page.getByRole('button', {name:'البحث برقم الهيكل VIN',exact:true}).click();
        check(`${device} homepage VIN control reopens intake`, await page.getByLabel('رقم الهيكل (VIN)',{exact:true}).isVisible());
        await page.getByRole('button',{name:'إغلاق طريقة البحث',exact:true}).click();
        check(`${device} contact visible in source`, await page.locator('a[href="tel:+966500894003"]').count() > 0);
      }
      if (name === 'companies') {
        await page.getByRole('button', { name: 'معدات', exact: true }).click();
        check(`${device} equipment brand filtering`, await page.getByRole('button', {name:'اختيار كاتربيلر',exact:true}).isVisible());
        check(`${device} equipment excludes passenger Toyota`, await page.getByRole('button', {name:'اختيار تويوتا',exact:true}).count() === 0);
        await page.getByRole('searchbox').fill('غيرموجود123');
        check(`${device} empty brand search`, await page.getByRole('heading', {name:'لم نجد علامة بهذا البحث'}).isVisible());
        await page.getByRole('button', {name:'عرض كل العلامات'}).click();
        await page.getByRole('searchbox').fill('toyota');
        check(`${device} Latin brand search`, await page.getByRole('button', {name:'اختيار تويوتا',exact:true}).isVisible());
        await page.getByRole('button', {name:'مسح البحث'}).click();
        check(`${device} logo resources load`, (await page.locator('img[src*="vehicle-brands"]').evaluateAll(images => Promise.all(images.map(img => { img.loading='eager'; return img.decode().then(()=>true,()=>false); })))).every(Boolean));
        await page.screenshot({path:resolve(directory,device+'-brand-grid.png'),fullPage:true,animations:'disabled'});report.screenshots.push(device+'-brand-grid.png');
        await page.getByRole('button', {name:'اختيار تويوتا',exact:true}).click();
        check(`${device} year waits for model`, await page.getByLabel('الموديل (سنة الصنع)',{exact:true}).isDisabled());
        await page.getByLabel('نوع المركبة (الطراز)',{exact:true}).selectOption('كامري');
        await page.getByLabel('الموديل (سنة الصنع)',{exact:true}).selectOption('2026');
        await page.getByLabel('الفئة',{exact:true}).fill('LE');
        await page.getByLabel('اسم القطعة أو رقمها',{exact:false}).fill('دينمو 000123-AB');
        check(`${device} confirmed vehicle enables handoff`, await page.getByRole('button', {name:'متابعة إلى مساعد رفرف'}).isEnabled());
        await page.screenshot({path:resolve(directory,device+'-vehicle-selection.png'),fullPage:true,animations:'disabled'});report.screenshots.push(device+'-vehicle-selection.png');
        await page.getByLabel('الموديل (سنة الصنع)',{exact:true}).selectOption('2012');
        check(`${device} changing year clears the grade`, await page.getByLabel('الفئة',{exact:true}).inputValue() === '');
        check(`${device} unknown historical grade has no invented suggestions`, await page.locator('#vehicle-trim-options option').count() === 0);
        await page.getByLabel('لا أعرف الفئة — ساعدني في تحديدها').check();
        await page.getByRole('button', {name:'متابعة إلى مساعد رفرف'}).click();
        var composer = page.getByRole('textbox',{name:'اكتب طلب قطعة الغيار'});
        await composer.waitFor({state:'visible'});
        check(`${device} vehicle details survive handoff`, (await composer.inputValue()).includes('كامري') && (await composer.inputValue()).includes('000123-AB'));
        await page.getByRole('button',{name:'رقم الهيكل',exact:true}).click();
        await page.getByLabel('رقم الهيكل (VIN)',{exact:true}).fill('123');
        await page.getByRole('button',{name:'استخدم في المحادثة'}).click();
        check(`${device} invalid VIN is rejected`, await page.locator('[role=alert]').filter({hasText:'17'}).isVisible());
        await page.getByLabel('رقم الهيكل (VIN)',{exact:true}).fill('JTNB11HK5M3087962');
        await page.getByRole('button',{name:'استخدم في المحادثة'}).click();
        check(`${device} VIN goes to composer without URL disclosure`, (await composer.inputValue()).includes('JTNB11HK5M3087962') && !page.url().includes('JTNB'));
        await page.getByRole('button',{name:'رقم القطعة',exact:true}).click();
        await page.getByLabel('رقم القطعة',{exact:true}).fill('000456-OEM');
        await page.getByRole('button',{name:'استخدم في المحادثة'}).click();
        check(`${device} part number keeps leading zeros`, (await composer.inputValue()).includes('000456-OEM'));
        await page.getByRole('button',{name:'اسم القطعة',exact:true}).click();
        await page.getByLabel('اسم القطعة',{exact:true}).fill('فلتر زيت');
        await page.getByRole('button',{name:'استخدم في المحادثة'}).click();
        check(`${device} part name reaches composer`, (await composer.inputValue()).includes('فلتر زيت'));
        await page.screenshot({path:resolve(directory,device+'-assistant-search.png'),fullPage:true,animations:'disabled'});report.screenshots.push(device+'-assistant-search.png');
        await page.getByRole('button',{name:'صورة القطعة',exact:true}).click();
        check(`${device} photo search retains authenticated upload gate`, await page.getByText('صورتك هي الخطوة التالية',{exact:true}).isVisible());
        await page.goto(report.origin+'/companies',{waitUntil:'networkidle'});
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
