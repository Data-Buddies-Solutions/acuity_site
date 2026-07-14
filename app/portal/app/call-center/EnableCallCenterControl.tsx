"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { CallCenterRequestError } from "@/lib/call-center/operator-error";

import { enableCallCenterAction, type EnableCallCenterState } from "./actions";
import { operatorErrorCopy } from "./call-center-errors";

const initialState: EnableCallCenterState = { error: null };

export function EnableCallCenterControl() {
  const [state, action, pending] = useActionState(enableCallCenterAction, initialState);
  const error = state.error
    ? operatorErrorCopy(new CallCenterRequestError(state.error), "enable")
    : null;

  return (
    <div className="space-y-2">
      <form action={action}>
        <Button disabled={pending} type="submit" variant="primary">
          {pending ? "Enabling…" : "Enable"}
        </Button>
      </form>
      {error ? (
        <p className="max-w-sm text-sm text-rose-700" role="alert">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
