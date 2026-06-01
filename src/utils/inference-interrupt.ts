/** True when LangGraph/Ollama stopped because the model was swapped or VRAM was reclaimed. */
export function isInferenceInterruptError(err: unknown): boolean {
  if (!err) return false;
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  return (
    name === 'AbortError' ||
    code === 'ABORT_ERR' ||
    msg === 'Abort' ||
    /aborted|abort/i.test(msg) ||
    msg.includes('model switch') ||
    msg.includes('This operation was aborted')
  );
}
