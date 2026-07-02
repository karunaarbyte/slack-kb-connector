const locks = new Map<string, Promise<unknown>>();

// Serializes async work by key — overlapping calls for the same key run one
// at a time, in call order. Used to stop two near-simultaneous triggers on
// the same Slack thread from racing on "does a KB entry already exist?"
// (one could read stale state before the other's write lands).
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) || Promise.resolve();
  const run = prior.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  tail.finally(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}
