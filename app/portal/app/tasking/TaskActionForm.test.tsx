import { afterEach, describe, expect, it } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";

import type { PortalTask } from "@/lib/portal-tasks";

import { TaskActionForm } from "./TaskActionForm";

expect.extend(matchers);
afterEach(cleanup);

const task: PortalTask = {
  callHref: null,
  callId: "call-1",
  callerPhone: "+15555550123",
  category: "appointments",
  createdAt: new Date("2026-07-15T12:00:00.000Z"),
  historyHref: "/portal/app/calls?phone=%2B15555550123",
  id: "task-1",
  locationLabel: "Springhill",
  message: "Call the patient back.",
  patientLabel: "Taylor Patient",
  priority: "normal",
  status: "open",
  summary: "Patient requested a callback",
};

describe("TaskActionForm", () => {
  it.each(["open", "in_progress"] as const)(
    "submits active %s tasks directly as done",
    (status) => {
      render(<TaskActionForm task={{ ...task, status }} />);

      const completed = screen.getByRole("button", { name: "Completed" });
      expect(completed).toHaveAttribute("type", "submit");
      expect(completed).toHaveAttribute("name", "status");
      expect(completed).toHaveAttribute("value", "done");
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    },
  );

  it("submits dismiss as closed without action", () => {
    render(<TaskActionForm task={task} />);

    const dismiss = screen.getByRole("button", {
      name: "Dismiss Patient requested a callback",
    });
    expect(dismiss).toHaveAttribute("type", "submit");
    expect(dismiss).toHaveAttribute("name", "status");
    expect(dismiss).toHaveAttribute("value", "closed_no_action");
  });

  it("keeps reopen as an explicit submit action", () => {
    render(<TaskActionForm task={{ ...task, status: "done" }} />);

    const reopen = screen.getByRole("button", { name: "Reopen" });
    expect(reopen).toHaveAttribute("type", "submit");
    expect(reopen).toHaveAttribute("value", "open");
  });
});
