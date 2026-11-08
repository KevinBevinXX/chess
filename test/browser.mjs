/* Shared test helpers: find a Chromium, agree on the site URL. */
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';

export const URL = process.env.SITE || 'http://127.0.0.1:8777/';

/** Playwright's own download, else a system Chrome. */
function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const cache = `${process.env.HOME}/.cache/ms-playwright`;
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = `${cache}/${d}/${sub}`;
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'])
    if (existsSync(p)) return p;
  return null;   // let Playwright try its default
}

export async function launch() {
  const executablePath = findChrome();
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
}

export function tracker() {
  const errs = [];
  const watch = (name, page) => {
    page.on('pageerror', (e) => errs.push(`${name} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`${name} console: ${m.text()}`); });
  };
  return { errs, watch };
}

export function reporter() {
  let pass = 0, fail = 0;
  return {
    ok: (n) => { pass++; console.log('  PASS  ' + n); },
    no: (n, d) => { fail++; console.log('  FAIL  ' + n + (d ? '  [' + d + ']' : '')); },
    done() {
      console.log(`\n${pass} passed, ${fail} failed`);
      return fail;
    },
  };
}
