/**
 * Runs `start` while `element` is on screen and the tab is in front, and
 * `stop` the rest of the time. Returns the teardown.
 *
 * Several sketches share the lab page, and a portfolio should not keep a
 * laptop fan running for canvases nobody is looking at. Both callbacks must be
 * safe to call twice in a row.
 */
export function whileVisible(
  element: Element,
  start: () => void,
  stop: () => void,
): () => void {
  let onScreen = true;

  const sync = () => {
    if (onScreen && document.visibilityState === "visible") start();
    else stop();
  };

  const observer = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
    sync();
  });
  observer.observe(element);
  document.addEventListener("visibilitychange", sync);
  sync();

  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", sync);
    stop();
  };
}
