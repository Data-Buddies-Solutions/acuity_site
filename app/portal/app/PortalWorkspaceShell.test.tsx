import { afterEach, describe, expect, it, mock } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

expect.extend(matchers);

const push = mock(() => {});
const signOut = mock(async () => {});
const nextNavigation = await import("next/navigation");

mock.module("next/navigation", () => ({
  ...nextNavigation,
  usePathname: () => "/portal/app/call-center",
  useRouter: () => ({ push, refresh: mock(() => {}), replace: mock(() => {}) }),
}));
mock.module("@/lib/auth-client", () => ({ authClient: { signOut } }));

const { default: PortalWorkspaceShell } = await import("./PortalWorkspaceShell");
const { setCallCenterCurrentCallGuard } =
  await import("./call-center/call-center-current-call-guard");

afterEach(() => {
  cleanup();
  setCallCenterCurrentCallGuard(null);
  push.mockClear();
  signOut.mockClear();
});

describe("PortalWorkspaceShell active-call navigation", () => {
  function renderShell() {
    return render(
      <PortalWorkspaceShell
        isLive
        practiceBranding={{
          accentColor: null,
          logoAlt: null,
          logoUrl: null,
          markUrl: null,
          primaryColor: null,
        }}
        practiceName="Practice"
      >
        <p>Active call controls</p>
      </PortalWorkspaceShell>,
    );
  }

  it("warns before leaving the Call Center while a call is active", () => {
    setCallCenterCurrentCallGuard("call-1");
    renderShell();

    fireEvent.click(screen.getAllByRole("link", { name: "Overview" })[0]!);

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Call in progress");
    expect(screen.getByRole("button", { name: "Stay in Call Center" })).toHaveFocus();
    expect(screen.getByText("Active call controls")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the controls mounted when the agent stays", () => {
    setCallCenterCurrentCallGuard("call-1");
    renderShell();

    fireEvent.click(screen.getAllByRole("link", { name: "Overview" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Stay in Call Center" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("Active call controls")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates only after the agent explicitly leaves", () => {
    setCallCenterCurrentCallGuard("call-1");
    renderShell();

    fireEvent.click(screen.getAllByRole("link", { name: "Overview" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Leave Call Center" }));

    expect(push).toHaveBeenCalledWith("/portal/app/overview");
  });

  it("does not warn when there is no active call", () => {
    renderShell();

    fireEvent.click(screen.getAllByRole("link", { name: "Overview" })[0]!);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks for confirmation before the browser unloads an active call", () => {
    setCallCenterCurrentCallGuard("call-1");
    renderShell();
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("warns before signing out during an active call", () => {
    setCallCenterCurrentCallGuard("call-1");
    renderShell();

    fireEvent.click(screen.getAllByRole("button", { name: "Sign out" })[0]!);

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Call in progress");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("guards the mobile dock with the same active-call warning", () => {
    setCallCenterCurrentCallGuard("call-1");
    renderShell();
    const overviewLinks = screen.getAllByRole("link", { name: "Overview" });

    fireEvent.click(overviewLinks[overviewLinks.length - 1]!);

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Call in progress");
  });

  it("keeps the controls mounted when the agent presses browser Back", () => {
    setCallCenterCurrentCallGuard("call-1");
    renderShell();

    fireEvent.popState(window);

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Call in progress");
    expect(screen.getByText("Active call controls")).toBeInTheDocument();
  });
});
