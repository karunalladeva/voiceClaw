import type { BrowserContext, Page } from 'playwright';
import { createStealthSession, type StealthSession } from './stealth-playwright';

const POOL_IDLE_MS = 90_000;

let pooledSession: StealthSession | null = null;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
let poolChain: Promise<void> = Promise.resolve();

function scheduleIdleClose(): void {
  if (idleCloseTimer) clearTimeout(idleCloseTimer);
  idleCloseTimer = setTimeout(() => {
    void closePlaywrightPool();
  }, POOL_IDLE_MS);
}

/** Close shared browser (e.g. on shutdown). */
export async function closePlaywrightPool(): Promise<void> {
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
  if (!pooledSession) return;
  const session = pooledSession;
  pooledSession = null;
  await session.browser.close().catch(() => {});
}

async function acquirePooledSession(): Promise<StealthSession> {
  if (pooledSession?.browser.isConnected()) {
    scheduleIdleClose();
    return pooledSession;
  }
  if (pooledSession) {
    await pooledSession.browser.close().catch(() => {});
    pooledSession = null;
  }
  pooledSession = await createStealthSession();
  scheduleIdleClose();
  return pooledSession;
}

/**
 * Reuse one stealth browser; opens a fresh tab per call and closes the tab after.
 * Serialize with withPlaywrightLock in callers.
 */
export async function withSharedStealthPage<T>(
  fn: (page: Page, context: BrowserContext) => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    const session = await acquirePooledSession();
    const page = await session.context.newPage();
    try {
      return await fn(page, session.context);
    } finally {
      await page.close().catch(() => {});
      scheduleIdleClose();
    }
  };
  const result = poolChain.then(run, run);
  poolChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
