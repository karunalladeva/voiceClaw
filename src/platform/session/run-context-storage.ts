import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunContext } from '../contracts';

const storage = new AsyncLocalStorage<RunContext>();

export function getRunContext(): RunContext | undefined {
  return storage.getStore();
}

export function getRunContextStorage(): AsyncLocalStorage<RunContext> {
  return storage;
}

export function runWithRunContext<T>(ctx: RunContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export async function runWithRunContextAsync<T>(ctx: RunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}
