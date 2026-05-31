/** True when LangGraph/Ollama stopped because the model was swapped or VRAM was reclaimed. */
export function isInferenceInterruptError(err: unknown): boolean {
  if (!err) return false;
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  return (
    name === 'AbortError' ||
    msg === 'Abort' ||
    /aborted|abort/i.test(msg) ||
    msg.includes('model switch')
  );
}
