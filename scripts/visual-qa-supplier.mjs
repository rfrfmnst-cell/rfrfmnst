import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const output = resolve('outputs/visual-review');
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['hostinger-runtime/bootstrap.cjs'], { env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3109', NODE_ENV: 'production' }, stdio: 'ignore' });
const report = { startedAtUtc: new Date().toISOString(), origin: 'http://127.0.0.1:3109', productionBuild: true, checks: [], screenshots: [], errors: [], passed: false };
let browser;
function check(name, ok) { report.checks.push({ name, ok: Boolean(ok) }); if (!ok) throw new Error(name); }
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const r = await fetch(report.origin + '/login', { signal: AbortSignal.timeout(1000) }); ready = r.ok; await r.body?.cancel(); if (ready) break; } catch { /* Starting owned preview. */ }
    await pause(1000);
  }
  check('supplier preview starts', ready);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const [device, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, locale: 'ar-SA', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push({ device, message: error.message }));
    for (const [name, path] of [['login', '/login'], ['registration', '/login?mode=register'], ['phone', '/login?mode=phone'], ['phone-not-allowed', '/login?mode=phone&err=not_allowed'], ['email-sent', '/login?step=check_email']]) {
      const r = await page.goto(report.origin + path, { waitUntil: 'networkidle', timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      check(`${device} ${name} HTTP200`, r?.status() === 200);
      check(`${device} ${name} RTL`, await page.locator('html').getAttribute('dir') === 'rtl');
      check(`${device} ${name} width`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check(`${device} ${name} heading`, await page.locator('h1').count() === 1);
      if (name === 'login') {
        check(`${device} missing email configuration has an explanation`, await page.getByRole('alert').filter({hasText:'خدمة الدخول بالبريد غير متاحة مؤقتًا.'}).isVisible());
        check(`${device} unavailable email login cannot be submitted`, await page.getByRole('button',{name:'إرسال رابط الدخول'}).isDisabled());
      }
      if (name === 'phone') {
        const phone=page.locator('input[name="phone"]');
        for(const value of ['٠٥١٢٣٤٥٦٧٨','۰۰۹۶۶۵۱۲۳۴۵۶۷۸','05 123 456 78']) {
          await phone.fill(value);
          check(`${device} phone browser accepts ${value}`, await phone.evaluate(input=>input.checkValidity()));
        }
        check(`${device} missing phone configuration cannot be submitted`, await page.getByRole('button',{name:'دخول',exact:true}).isDisabled());
        await phone.fill('');
      }
      if (name === 'registration') check(`${device} trial visible`, await page.getByRole('heading', { name: 'جرّب رفرف لمدة 3 أشهر' }).isVisible());
      if (name === 'phone-not-allowed') {
        check(`${device} account rejection has accurate recovery`, await page.getByRole('alert').getByRole('link', { name: 'تواصل مع دعم رفرف' }).isVisible());
        check(`${device} account rejection is not described as session expiry`, !(await page.locator('.login-err[role="alert"]').innerText()).includes('انتهت جلسة'));
        check(`${device} new supplier registration is reachable`, await page.getByRole('link', { name: 'إنشاء حساب مورد' }).getAttribute('href') === '/login?mode=register');
      }
      const filename = `${device}-${name}.png`;
      await page.screenshot({ path: resolve(output, filename), fullPage: true, animations: 'disabled' });
      report.screenshots.push(filename);
    }
    await context.close();
  }
  check('no browser errors', report.errors.length === 0);
  report.passed = true;
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally { await browser?.close(); server.kill(); report.finishedAtUtc = new Date().toISOString(); await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); }
