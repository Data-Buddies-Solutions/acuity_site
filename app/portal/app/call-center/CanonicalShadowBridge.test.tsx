import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { CanonicalShadowStatus } from "./CanonicalShadowBridge";

afterEach(cleanup);

describe("CanonicalShadowStatus", () => {
  test("shows only aggregate shadow state", () => {
    render(
      <CanonicalShadowStatus
        active={1}
        agentReady
        revision="42"
        status="synced"
        waiting={2}
      />,
    );

    expect(screen.getByText("New call center shadow")).toBeTruthy();
    expect(screen.getByText("Synced · station ready")).toBeTruthy();
    expect(screen.getByText("2 waiting")).toBeTruthy();
    expect(screen.getByText("1 active")).toBeTruthy();
    expect(screen.getByText("Revision 42")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("does not show stale counts while unavailable", () => {
    render(
      <CanonicalShadowStatus active={4} revision="91" status="unavailable" waiting={3} />,
    );

    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("3 waiting")).toBeNull();
    expect(screen.queryByText("4 active")).toBeNull();
    expect(screen.queryByText("Revision 91")).toBeNull();
  });
});
