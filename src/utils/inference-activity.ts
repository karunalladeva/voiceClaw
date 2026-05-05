export class InferenceActivityTracker {
  private activeRequests = 0;

  begin(): () => void {
    this.activeRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    };
  }

  hasActiveInference(): boolean {
    return this.activeRequests > 0;
  }

  getActiveCount(): number {
    return this.activeRequests;
  }
}

export const inferenceActivity = new InferenceActivityTracker();
