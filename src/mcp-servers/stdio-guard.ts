/**
 * MCP servers speak JSON-RPC on stdout. When the parent client disconnects,
 * writes can throw EPIPE — treat as a normal shutdown, not a crash.
 */
function isPipeClosedError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException;
  return e?.code === 'EPIPE' || e?.code === 'ECONNRESET';
}

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (isPipeClosedError(err)) return;
    console.error('[MCP stdio]', err);
  });
}

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (isPipeClosedError(err)) {
    process.exit(0);
    return;
  }
  console.error('[MCP] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  if (isPipeClosedError(reason)) return;
  console.error('[MCP] Unhandled rejection:', reason);
});
