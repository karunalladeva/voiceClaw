import { isInferenceInterruptError } from '../../utils/inference-interrupt';

export { isInferenceInterruptError as isGraphAbortError };

export interface ConsumeGraphStreamOptions {
  signal?: AbortSignal;
  /** When true, swallow abort errors from the underlying stream (orchestration handoff). */
  swallowAbortWhenDone?: () => boolean;
}

type AsyncStreamIterator<T> = AsyncIterator<T> & {
  return?: (value?: unknown) => Promise<IteratorResult<T>>;
};

/** Best-effort close; never rethrows LangGraph abort errors. */
export async function closeGraphStream<T>(
  iterator: AsyncStreamIterator<T> | null | undefined,
): Promise<void> {
  if (!iterator?.return) return;
  try {
    await iterator.return(undefined);
  } catch (err: unknown) {
    if (!isInferenceInterruptError(err)) {
      console.warn('[GraphStream] close:', err);
    }
  }
}

/**
 * Consume LangGraph streamEvents without passing AbortSignal into LangGraph
 * (avoids synchronous Error: Abort from pregel abort listeners).
 */
export async function* consumeGraphStreamEvents<T>(
  stream: AsyncIterable<T>,
  options?: ConsumeGraphStreamOptions,
): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]() as AsyncStreamIterator<T>;
  try {
    while (true) {
      if (options?.signal?.aborted) {
        break;
      }
      let step: IteratorResult<T>;
      try {
        step = await iterator.next();
      } catch (err: unknown) {
        if (options?.swallowAbortWhenDone?.() && isInferenceInterruptError(err)) {
          break;
        }
        throw err;
      }
      if (step.done) break;
      yield step.value;
    }
  } finally {
    await closeGraphStream(iterator);
  }
}
