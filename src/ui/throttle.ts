/** After a slow run, wait this many times as long as it took before the next. */
const SLOWDOWN = 3;

/**
 * Wraps `task` so calling it runs it right away, unless the last run was
 * slow: then it runs no sooner than a few times that run's duration after
 * it ended, so slow work (such as rebuilding the 3D model of a large
 * document) can't take every frame while the user draws. Calls in between
 * collapse into one run when that time comes, so the last change is never
 * missed. Fast tasks run on every call.
 */
export function adaptiveThrottle(task: () => void): () => void {
  let readyAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    timer = undefined;
    const start = performance.now();
    task();
    const end = performance.now();
    readyAt = end + (end - start) * SLOWDOWN;
  };
  return () => {
    const now = performance.now();
    if (now >= readyAt) {
      clearTimeout(timer);
      run();
    } else {
      timer ??= setTimeout(run, readyAt - now);
    }
  };
}
