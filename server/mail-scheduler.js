// Background mail scan inside the Node process: a first scan 30 s after
// start, then one every mail.interval_min minutes. One scan at a time (the
// engine refuses overlapping scans too); a failing scan never stops the loop.
// The same tick runs the daily jobs once per local day (the receivables ladder),
// so nothing else needs a timer of its own.
import { scanMail } from "./mail-engine.js";
import { mailSettings } from "./mail-settings.js";
import { runtime } from "./mail-runtime.js";
import { dailyCheck } from "./receivables.js";
import { getSetting, setSetting } from "./db.js";
import { today as todayLocal } from "./dates.js";

export const FIRST_DELAY_MS = 30_000;
export const DAILY_KEY = "receivables.last_check";

/**
 * Injectable timers and scan function keep it testable:
 * createMailScheduler({ scan, settings, setTimer, clearTimer, clock, firstDelayMs }).
 * `daily` is the once-a-day job and `lastDay`/`markDay` remember the day it last
 * ran, so a restart does not repeat it.
 */
export function createMailScheduler({
  scan = (options) => scanMail(options), settings = mailSettings, setTimer = setTimeout, clearTimer = clearTimeout,
  clock = Date.now, firstDelayMs = FIRST_DELAY_MS, daily = dailyCheck, today = todayLocal,
  lastDay = () => getSetting(DAILY_KEY, ""), markDay = (day) => setSetting(DAILY_KEY, day),
} = {}) {
  let timer = null;
  let running = false;
  let inFlight = null;

  const schedule = (delayMs) => {
    runtime.nextScanTs = Math.floor((clock() + delayMs) / 1000);
    timer = setTimer(tick, delayMs);
    timer?.unref?.();
  };

  /** The daily job, at most once per local day; a failure is retried on the next tick. */
  async function runDaily() {
    const day = today();
    if (lastDay() === day) return null;
    const out = await daily({ today: day });
    markDay(day);
    return out;
  }

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
      // the chase does not depend on reading the mail: it runs even with the scan off
      await runDaily().catch(() => null);
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
    /** Run the daily job now, ignoring the day it last ran (tests and "Comprobar ahora"). */
    runDaily,
    get running() { return running; },
  };
}