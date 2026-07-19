const MAX_RETRY_DELAY_MS = 30_000;

export function callCenterRetryDelay(
  attempt: number,
  baseMs: number,
  random = Math.random,
) {
  const ceiling = Math.min(baseMs * 2 ** Math.min(attempt, 5), MAX_RETRY_DELAY_MS);
  return Math.floor(ceiling * (0.75 + random() * 0.25));
}
