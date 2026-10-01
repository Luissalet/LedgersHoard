// Background mail scan inside the Node process: a first scan 30 s after
// start, then one every mail.interval_min minutes. One scan at a time (the
// engine refuses overlapping scans too); a failing scan never stops the loop.
import { scanMail } from "./mail-engine.js";
import { mailSettings } from "./mail-settings.js";
import { runtime } from "./mail-runtime.js";

export const FIRST_DELAY_MS = 30_000;

/**
 * Injectable timers and scan function keep it testable:
 * createMailScheduler({ scan, settings, setTimer, clearTimer, clock, firstDelayMs }).
 */
export function createMailScheduler({
  scan = (options) => scanMail(options), settings = mailSettings, setTimer = setTimeout, clearTimer = clearTimeout,
  clock = Date.now, firstDelayMs = FIRST_DELAY_MS,
} = {}) {
  let timer = null;
  let running = false;
  let inFlight = null;

  const schedule = (delayMs) => {
    runtime.nextScanTs = Math.floor((clock() + delayMs) / 1000);
    timer = setTimer(tick, delayMs);
    timer?.unref?.();
  };

  async function tick() {
    timer = null;
    if (!running) return;
    let intervalMs = 15 * 60_000;
    try {
      const s = settings();
      intervalMs = Math.max(2, s.interval_min) * 60_000;
      if (s.enabled && !inFlight) {
        inFlight = Promise.resolve(scan({ trigger: "schedule" })).catch(() => null).finally(() => { inFlight = null; });
        await inFlight;
      }
    } catch { /* the loop survives anything */ }
    if (running) schedule(intervalMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      runtime.schedulerRunning = true;
      schedule(firstDelayMs);
    },
    stop() {
      running = false;
      runtime.schedulerRunning = false;
      runtime.nextScanTs = null;
      if (timer) clearTimer(timer);
      timer = null;
    },
    /** Run the scheduled job now (used by tests and "Leer ahora" never goes through here). */
    tick,
    get running() { return running; },
  };
}
