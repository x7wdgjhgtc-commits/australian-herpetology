/**
 * In-app navigation history tracker (path-based routing).
 *
 * Why this exists: the app can run inside the Perplexity iframe proxy where
 * `window.history.length` is almost always > 1 even on the user's first
 * internal page, because the parent shell already pushed entries before the
 * iframe loaded. Calling `window.history.back()` blindly steps PAST our
 * earliest internal entry into the parent (Perplexity) shell — visually
 * "exiting" the app window.
 *
 * We therefore maintain our own stack of internal routes, populated by the
 * `popstate` event and `pushState`/`replaceState` patches. A back navigation
 * is "safe" only when our stack has at least 2 entries; otherwise the
 * caller should fall back to in-app routing.
 *
 * This is intentionally a module-level singleton.
 */

const STACK_LIMIT = 50;
const internalStack: string[] = [];
let installed = false;

function currentRoute(): string {
  if (typeof window === "undefined") return "/";
  // Use pathname+search so legacy ?speciesId= style links are tracked too.
  return (window.location.pathname || "/") + (window.location.search || "");
}

/** Push a path, dedup consecutive duplicates, cap stack size. */
function record(path: string) {
  const top = internalStack[internalStack.length - 1];
  if (top === path) return;
  internalStack.push(path);
  if (internalStack.length > STACK_LIMIT) {
    internalStack.splice(0, internalStack.length - STACK_LIMIT);
  }
}

/**
 * Install the tracker. Safe to call repeatedly — only attaches listeners once.
 * Patches history.pushState/replaceState so wouter's setLocation() calls
 * (which use pushState under the hood) feed our stack.
 */
export function installNavHistory() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  record(currentRoute());

  // Patch pushState/replaceState so we can observe SPA navigations. wouter's
  // default browser-location hook calls history.pushState() on setLocation,
  // which does NOT fire any event by itself.
  const origPush = window.history.pushState.bind(window.history);
  const origReplace = window.history.replaceState.bind(window.history);

  window.history.pushState = function (...args: Parameters<History["pushState"]>) {
    origPush(...args);
    record(currentRoute());
  };

  window.history.replaceState = function (
    ...args: Parameters<History["replaceState"]>
  ) {
    origReplace(...args);
    // replaceState swaps the current entry in place — update the top of the
    // stack rather than pushing a new one.
    const path = currentRoute();
    if (internalStack.length === 0) {
      internalStack.push(path);
    } else {
      internalStack[internalStack.length - 1] = path;
    }
  };

  // popstate fires on real browser back/forward.
  window.addEventListener("popstate", () => {
    const path = currentRoute();
    if (
      internalStack.length >= 2 &&
      internalStack[internalStack.length - 2] === path
    ) {
      internalStack.pop();
    } else if (internalStack[internalStack.length - 1] !== path) {
      record(path);
    }
  });
}

/** Does our internal stack have a previous entry we can return to? */
export function canGoBackInternal(): boolean {
  return internalStack.length >= 2;
}

/**
 * Return the previous internal path (one below the top of the stack) and
 * pop the current entry off, OR null if there's no previous in-app entry.
 *
 * We never call window.history.back() because in the Perplexity iframe
 * proxy the browser's history stack contains entries from the parent shell;
 * a single history.back() can step past our iframe entirely, killing the
 * app view. Instead, the caller should setLocation(previousPath) so wouter
 * pushes a new path entry inside the SPA — always safe.
 */
export function popPreviousInternal(): string | null {
  if (!canGoBackInternal()) return null;
  // Drop the current top (we're leaving it) and read the new top.
  internalStack.pop();
  const prev = internalStack[internalStack.length - 1] ?? null;
  // Also pop the destination, because the upcoming setLocation() will push
  // it back on via the pushState patch — avoids duplicate adjacent entries.
  if (prev) internalStack.pop();
  return prev;
}

/** Exposed for debugging / tests. */
export function _peekStack(): readonly string[] {
  return internalStack;
}
