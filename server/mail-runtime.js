// Small shared state between the mail engine and its scheduler (no imports,
// so neither depends on the other).
export const runtime = { scanning: false, nextScanTs: null, schedulerRunning: false };
