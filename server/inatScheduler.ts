/**
 * Background auto-sync for connected iNaturalist accounts.
 *
 * Every `intervalMs` (default 60 min) the scheduler scans every user with
 * `inatUsername` set and re-runs `syncInatForUser` for any whose
 * `inatLastImportAt` is older than `staleMs` (or null).
 *
 * Failures for a single user never stop the loop — they are logged and the
 * next user proceeds. A short delay is inserted between users to be polite
 * to the iNat public API.
 */

import { storage } from "./storage";
import { syncInatForUser } from "./inat";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // run scheduler hourly
const DEFAULT_STALE_MS = 60 * 60 * 1000; // resync if last import > 1h old
const PER_USER_DELAY_MS = 3_000; // pause between user syncs

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

function log(msg: string) {
  const t = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${t} [inat-auto] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run one pass: sync every connected user whose last import is older than
 * `staleMs`. Sequential, with a polite delay between users.
 */
async function runPass(staleMs: number): Promise<void> {
  if (inFlight) {
    log("skipping pass — previous pass still running");
    return;
  }
  inFlight = true;
  try {
    const candidates = storage.listUsersWithInat();
    const cutoff = Date.now() - staleMs;
    const due = candidates.filter(
      (u) => !u.inatLastImportAt || u.inatLastImportAt < cutoff,
    );
    if (due.length === 0) {
      log(
        `pass complete — ${candidates.length} connected, 0 due (next pass in ${
          Math.round(staleMs / 60_000)
        }m)`,
      );
      return;
    }
    log(`pass start — ${due.length} of ${candidates.length} connected users due`);
    for (const user of due) {
      const login = user.inatUsername;
      if (!login) continue;
      try {
        const summary = await syncInatForUser(user.id, login);
        log(
          `synced @${login} (user ${user.id}): scanned ${summary.scanned}, imported ${summary.imported}, skipped ${summary.skipped}, failed ${summary.failed}`,
        );
      } catch (err: any) {
        log(`FAILED @${login} (user ${user.id}): ${err?.message || err}`);
      }
      // Be polite to the iNat API — short delay between users.
      await sleep(PER_USER_DELAY_MS);
    }
    log("pass complete");
  } finally {
    inFlight = false;
  }
}

/**
 * Start the background scheduler. The first pass runs after `initialDelayMs`
 * so the server can finish booting and serving traffic before doing work.
 *
 * Returns a function that stops the scheduler (useful for tests).
 */
export function startInatAutoSync(opts?: {
  intervalMs?: number;
  staleMs?: number;
  initialDelayMs?: number;
}): () => void {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const initialDelayMs = opts?.initialDelayMs ?? 30_000;

  if (timer) {
    log("already running — ignoring duplicate start");
    return () => {};
  }

  log(
    `starting — interval ${Math.round(intervalMs / 60_000)}m, stale-after ${
      Math.round(staleMs / 60_000)
    }m, first pass in ${Math.round(initialDelayMs / 1000)}s`,
  );

  // Fire-and-forget first pass.
  setTimeout(() => {
    runPass(staleMs).catch((err) => log(`pass error: ${err?.message || err}`));
  }, initialDelayMs);

  timer = setInterval(() => {
    runPass(staleMs).catch((err) => log(`pass error: ${err?.message || err}`));
  }, intervalMs);

  // Don't keep the event loop alive just for this timer.
  if (typeof timer.unref === "function") timer.unref();

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      log("stopped");
    }
  };
}
