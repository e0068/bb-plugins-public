/**
 * `run` that never runs twice at the same time: a caller arriving while it is
 * still running gets that run's result (or failure) instead of starting
 * another. Nothing is kept once the run has finished, so the next caller
 * reads fresh data — this joins concurrent work, it is not a cache.
 */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight !== null) return inFlight;
    const started: Promise<T> = run().finally(() => {
      if (inFlight === started) inFlight = null;
    });
    inFlight = started;
    return started;
  };
}
