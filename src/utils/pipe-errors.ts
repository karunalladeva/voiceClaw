export function isPipeClosedError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException;
  return e?.code === 'EPIPE' || e?.code === 'ECONNRESET';
}
