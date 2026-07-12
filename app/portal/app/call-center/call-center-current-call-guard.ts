"use client";

import { useSyncExternalStore } from "react";

const CURRENT_CALL_KEY = "acuity.call-center.current-call";
const CURRENT_CALL_EVENT = "acuity:call-center-current-call";

function snapshot() {
  return Boolean(window.sessionStorage.getItem(CURRENT_CALL_KEY));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CURRENT_CALL_EVENT, onChange);
  return () => window.removeEventListener(CURRENT_CALL_EVENT, onChange);
}

export function setCallCenterCurrentCallGuard(callId: string | null) {
  if (callId) {
    window.sessionStorage.setItem(CURRENT_CALL_KEY, callId);
  } else {
    window.sessionStorage.removeItem(CURRENT_CALL_KEY);
  }
  window.dispatchEvent(new Event(CURRENT_CALL_EVENT));
}

export function useCallCenterCurrentCallGuard() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
