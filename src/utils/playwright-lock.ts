/** One Playwright browser at a time — parallel launches hang the Node process on Windows. */
let playwrightChain: Promise<unknown> = Promise.resolve();

export function withPlaywrightLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = playwrightChain.then(fn, fn);
  playwrightChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
