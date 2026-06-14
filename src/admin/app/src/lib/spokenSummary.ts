/** Remove TTS-only block from agent messages before display. */
export function removeSpokenSummaryBlock(raw: string): string {
  return raw.replace(/<spoken_summary>[\s\S]*?<\/spoken_summary>/gi, '').trim()
}
