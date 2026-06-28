/**
 * In-app navigation history tracker (hash-based routing).
 *
 * Why this exists: the app runs inside the Perplexity iframe proxy AND uses
 * hash routing (`useHashLocation`). `window.history.length` is almost always
 * > 1 even on the user's first internal page, because the parent shell already
 * pushed entries before the iframe loaded. Calling `window.history.back()`
 * blindly steps PAST our earliest internal hash entry into the parent
 * (Perplexity) shell — visually "exiting" the app window.
 *
 * We therefore maintain our own stack of internal hash routes, populated by
 * the `hashchange` event. A back navigation is "safe" only when our stack has
 * at least 2 entries; otherwise we fall back to in-app routing.
 *
 * This is intentionally a module-level singleton.
 */

const STACK_LIMIT = 50;
const internalStack: string[] = [];
let installed = false;

function currentHashRoute(): string {
  if (typeof window === "undefined") return "/";
  // strip the leading "#" — keep "/" prefix if present, default to "/"
  const h = window.location.hash || "#/";
  return h.startsWith("#") ? h.slice(1) || "/" : h;
}

/** Push the current location, dedup consecutive duplicates, cap stack size. */
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
 * Tracks hash changes (route changes) and popstate (browser back/forward).
 */
export function installNavHistory() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  record(currentHashRoute());

  window.addEventListener("hashchange", () => {
    const path = currentHashRoute();
    // If this hashchange was caused by our own goBackInternal() call, the
    // popstate handler below will have already trimmed the stack — so just
    // make sure the current entry matches the top.
    const top = internalStack[internalStack.length - 1];
    if (top !== path) {
      // If the user navigated to a path we already have one step below the
      // top, treat it as a back — pop instead of pushing a duplicate.
      if (
        internalStack.length >= 2 &&
        internalStack[internalStack.length - 2] === path
      ) {
        internalStack.pop();
      } else {
        record(path);
      }
    }
  });

  // popstate fires on back/forward (including ours). Keep stack synced.
  window.addEventListener("popstate", () => {
    const path = currentHashRoute();
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
 * pushes a new hash entry inside the SPA — always safe.
 */
export function popPreviousInternal(): string | null {
  if (!canGoBackInternal()) return null;
  // Drop the current top (we're leaving it) and read the new top.
  internalStack.pop();
  const prev = internalStack[internalStack.length - 1] ?? null;
  // Also pop the destination, because the upcoming setLocation() will push
  // it back on via the hashchange listener — avoids duplicate adjacent entries.
  if (prev) internalStack.pop();
  return prev;
}

/** Exposed for debugging / tests. */
export function _peekStack(): readonly string[] {
  return internalStack;
}
