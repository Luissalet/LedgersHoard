// Shared by the mail tests: a fake Faustus mail source and notification sinks.
import { setMailSource } from "../server/mail-source.js";
import { setNotifyBackends, resetNotifyBackends } from "../server/notifications.js";

/** Fake source: scan() answers with `messages` (minus the ids in skip) and keeps every request. */
export function fakeSource(messages = [], { ok = true, error = "", delay = 0, status = null } = {}) {
  const source = {
    messages,
    requests: [],
    calls: 0,
    async scan(request) {
      source.calls++;
      source.requests.push(request);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (!ok) return { ok: false, error };
      const skip = new Set(request.skip || []);
      return { ok: true, error, accounts: [{ account: "Cuenta de prueba", folder: "INBOX", matches: source.messages.length }], messages: source.messages.filter((m) => !skip.has(m.message_id)) };
    },
    async status() {
      return status || { ok: true, error: "", accounts: [{ account: "Cuenta de prueba", user: "ej***@example.test", server: "imap.example.test:993" }], faustus_dir: "/fake/faustus" };
    },
  };
  return source;
}

export function installFakeSource(messages, options) {
  const source = fakeSource(messages, options);
  setMailSource(source);
  return source;
}

/** Collect hub events and toasts instead of sending them. */
export function captureNotifications({ platform = "linux" } = {}) {
  const events = [];
  const scripts = [];
  setNotifyBackends({
    platform: () => platform,
    hub: async (type, data) => { events.push({ type, data }); return true; },
    powershell: async (exe, args) => { scripts.push({ exe, args }); return { code: 0 }; },
  });
  return { events, scripts, restore: resetNotifyBackends };
}

export { setMailSource as setMailSourceFor };
