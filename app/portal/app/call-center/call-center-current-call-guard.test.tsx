import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";

const push = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

import {
  setCallCenterCurrentCallGuard,
  useCallCenterCurrentCallGuard,
} from "./call-center-current-call-guard";
import LocationPicker from "./LocationPicker";
import { QueuePicker } from "./QueuePicker";

function StationSwitch() {
  const guarded = useCallCenterCurrentCallGuard();
  return <select aria-label="Station" disabled={guarded} />;
}

function Switches() {
  return (
    <>
      <LocationPicker
        currentId="location-1"
        guardCurrentCall
        locations={[
          {
            id: "location-1",
            label: "Optical",
            locationId: "location-1",
            outboundNumber: "",
          },
        ]}
      />
      <QueuePicker
        currentId="queue-1"
        office="location-1"
        queues={[{ id: "queue-1", name: "Optical" }]}
      />
      <StationSwitch />
    </>
  );
}

afterEach(() => {
  cleanup();
  setCallCenterCurrentCallGuard(null);
  push.mockClear();
});

describe("current-call navigation guard", () => {
  it("keeps station, queue, and location switches disabled across remount", () => {
    setCallCenterCurrentCallGuard("call-1");
    const first = render(<Switches />);

    for (const select of screen.getAllByRole("combobox")) {
      expect((select as HTMLSelectElement).disabled).toBe(true);
    }

    first.unmount();
    render(<Switches />);
    for (const select of screen.getAllByRole("combobox")) {
      expect((select as HTMLSelectElement).disabled).toBe(true);
    }
  });

  it("re-enables switching only after the canonical session clears its current call", () => {
    setCallCenterCurrentCallGuard("call-1");
    render(<Switches />);

    act(() => setCallCenterCurrentCallGuard(null));

    for (const select of screen.getAllByRole("combobox")) {
      expect((select as HTMLSelectElement).disabled).toBe(false);
    }
  });
});
