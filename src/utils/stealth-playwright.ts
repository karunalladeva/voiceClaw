import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { FingerprintGenerator } from 'fingerprint-generator';
import { FingerprintInjector } from 'fingerprint-injector';

const fingerprintGenerator = new FingerprintGenerator({
  devices: ['desktop'],
  browsers: [{ name: 'chrome', minVersion: 110 }],
  operatingSystems: ['windows', 'macos'],
});

export type StealthSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

/** Launch Chromium with anti-automation flags and inject a realistic fingerprint. */
export async function createStealthSession(): Promise<StealthSession> {
  const generated = fingerprintGenerator.getFingerprint();
  const { fingerprint, headers } = generated;
  const viewportHeight = Math.max(fingerprint.screen.height - 100, 800);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-position=0,0',
      `--window-size=${fingerprint.screen.width},${fingerprint.screen.height}`,
    ],
  });
  const context = await browser.newContext({
    userAgent: fingerprint.navigator.userAgent,
    locale: fingerprint.navigator.language,
    viewport: { width: fingerprint.screen.width, height: viewportHeight },
    extraHTTPHeaders: {
      'Accept-Language': headers['accept-language'] ?? 'en-US,en;q=0.9',
    },
  });
  const fingerprintInjector = new FingerprintInjector();
  await fingerprintInjector.attachFingerprintToPlaywright(context, generated);
  const page = await context.newPage();
  return { browser, context, page };
}

/** Run a callback inside a stealth browser session; always closes browser. */
export async function withStealthBrowser<T>(
  fn: (session: StealthSession) => Promise<T>,
): Promise<T> {
  const session = await createStealthSession();
  try {
    return await fn(session);
  } finally {
    await session.browser.close().catch(() => {});
  }
}
