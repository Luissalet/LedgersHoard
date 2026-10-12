// React glue for copilot-context.js: pages and forms tell the copilot what they show, and reload when a turn ends.
import { useEffect, useRef } from "react";
import { registerProvider, subscribeRefresh } from "./copilot-context.js";

/** `getter()` returns { editors?: [{ kind, object_id, dirty, fields }], view?: {...} }; it is read when the copilot asks. */
export function useCopilotContext(getter) {
  const ref = useRef(getter);
  ref.current = getter;
  useEffect(() => registerProvider(() => ref.current()), []);
}

/** Run `fn` once when the assistant finishes a turn (never remounts anything; forms keep what the user typed). */
export function useCopilotRefresh(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribeRefresh(() => ref.current && ref.current()), []);
}
