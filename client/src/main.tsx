import { createRoot } from "react-dom/client";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./index.css";
import { installNavHistory } from "./lib/navHistory";

/**
 * Legacy hash-route compatibility shim.
 *
 * The app used to ship with `useHashLocation`, so every shared link, bookmark,
 * and embedded asset still points at `/#/species/35161`, `/#/u/willhunt`,
 * etc. Now that we've switched to clean path-based URLs, rewrite any
 * incoming hash route to its path equivalent BEFORE React boots so wouter
 * sees the right pathname on first render.
 *
 * `history.replaceState` is used (not `assign`) so the redirect doesn't add
 * an extra entry to the browser back stack.
 */
if (window.location.hash && window.location.hash.startsWith("#/")) {
  // The legacy URL shape was `/#/foo?bar` — everything after the `#` is the
  // route. Strip the `#` and use that as the new pathname+search. Build an
  // absolute URL so the browser unambiguously commits the address-bar update
  // (some Chromium builds keep a stale hash in the UI when replaceState is
  // called with a same-origin path that differs only in the hash fragment).
  const hashPath = window.location.hash.slice(1); // "#/foo?bar" -> "/foo?bar"
  const newUrl = new URL(hashPath, window.location.origin);
  // Force-clear any residual hash, then replace.
  window.history.replaceState(null, "", newUrl.pathname + newUrl.search);
}

installNavHistory();

createRoot(document.getElementById("root")!).render(<App />);
