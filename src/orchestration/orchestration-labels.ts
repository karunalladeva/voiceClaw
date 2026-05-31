/** Root task label enabling opt-in pipeline behaviors (pin, fast-review, supersede). */
export const PIPELINE_MODE_LABEL = 'pipeline-mode';

export function hasPipelineModeLabel(labels: string[] | undefined): boolean {
  return labels?.includes(PIPELINE_MODE_LABEL) ?? false;
}
