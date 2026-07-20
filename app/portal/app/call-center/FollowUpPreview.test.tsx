import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FollowUpPreview from "./FollowUpPreview";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function previewItem(index: number) {
  return {
    callerName: index === 0 ? "Patient One" : null,
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    disposition: index % 3 === 2 ? "FOLLOW_UP_REQUIRED" : null,
    durationSec: index % 3 === 1 ? 24 : null,
    fromPhone: `+15555550${index.toString().padStart(3, "0")}`,
    id: `task-${index}`,
    kind: index % 3 === 0 ? "missed" : index % 3 === 1 ? "voicemail" : "note",
    locationName: "Optical",
    recordingId: index % 3 === 1 ? `recording-${index}` : null,
  };
}

describe("FollowUpPreview", () => {
  it("loads and renders only the independent 15-item response", async () => {
    let resolved = false;
    const fetchPreview = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        resolved = true;
        return Response.json({ ok: true, resolvedCount: 1 });
      }
      return Response.json({
        items: Array.from({ length: resolved ? 14 : 15 }, (_, index) =>
          previewItem(index + (resolved ? 1 : 0)),
        ),
        limit: 15,
      });
    });
    const callback = mock(() => {});
    globalThis.fetch = fetchPreview as unknown as typeof fetch;

    render(
      <FollowUpPreview
        followUpHref="/portal/app/call-center/follow-up?office=location-1&queue=queue-1"
        locationId="location-1"
        onCallback={callback}
        queueId="queue-1"
      />,
    );

    await waitFor(() => expect(screen.getByText("15 recent")).toBeTruthy());
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    expect(String(fetchPreview.mock.calls[0]?.[0])).toBe(
      "/api/portal/call-center/follow-up-preview?queueId=queue-1&locationId=location-1",
    );
    expect(screen.getAllByRole("button", { name: /^Call back / })).toHaveLength(15);
    expect(screen.getAllByRole("button", { name: /^Mark .* resolved$/ })).toHaveLength(
      15,
    );
    expect(screen.getByText("Patient One")).toBeTruthy();
    expect(screen.getAllByText("Missed call")).toHaveLength(5);
    expect(screen.getAllByText("Voicemail")).toHaveLength(5);
    expect(screen.getAllByText("Follow-up required")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Call back Patient One" }));
    expect(callback).toHaveBeenCalledWith("+15555550000");

    fireEvent.click(screen.getByRole("button", { name: "Mark Patient One resolved" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Call back / })).toHaveLength(14),
    );
    expect(String(fetchPreview.mock.calls[1]?.[0])).toBe(
      "/api/portal/call-center/follow-up-preview",
    );
    expect(fetchPreview.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({
        locationId: "location-1",
        phone: "+15555550000",
        queueId: "queue-1",
      }),
      method: "POST",
    });
  });

  it("contains preview failures and leaves an explicit retry path", async () => {
    const fetchPreview = mock(async (_input: RequestInfo | URL) => {
      throw new Error("preview unavailable");
    });
    globalThis.fetch = fetchPreview as unknown as typeof fetch;

    render(
      <FollowUpPreview
        followUpHref="/portal/app/call-center/follow-up"
        onCallback={() => {}}
        queueId="queue-1"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Follow-up preview delayed. Calling is unaffected."),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText("No missed calls, voicemails, or follow-ups need action."),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(2));
  });

  it("clears retained items when a refresh loses queue access", async () => {
    let readCount = 0;
    const fetchPreview = mock(async (_input: RequestInfo | URL) => {
      readCount += 1;
      if (readCount === 1) {
        return Response.json({ items: [previewItem(0)], limit: 15 });
      }
      return Response.json(
        {
          error: {
            code: "ACCESS_DENIED",
            referenceId: "ACCESS1",
            retryable: false,
          },
        },
        { status: 403 },
      );
    });
    globalThis.fetch = fetchPreview as unknown as typeof fetch;

    const { unmount } = render(
      <FollowUpPreview
        followUpHref="/portal/app/call-center/follow-up"
        onCallback={() => {}}
        queueId="queue-1"
        refreshIntervalMs={20}
      />,
    );

    await waitFor(() => expect(screen.getByText("Patient One")).toBeTruthy());
    await waitFor(() =>
      expect(
        screen.getByText("Follow-up preview delayed. Calling is unaffected."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Patient One")).toBeNull();
    unmount();
  });

  it("does not restore a resolved caller from an older in-flight refresh", async () => {
    let getCount = 0;
    let resolveStaleRead!: (response: Response) => void;
    const staleRead = new Promise<Response>((resolve) => {
      resolveStaleRead = resolve;
    });
    const fetchPreview = mock(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === "POST") {
          return Response.json({ ok: true, resolvedCount: 1 });
        }
        getCount += 1;
        if (getCount === 1) {
          return Response.json({ items: [previewItem(0)], limit: 15 });
        }
        if (getCount === 2) return staleRead;
        return Response.json({ items: [], limit: 15 });
      },
    );
    globalThis.fetch = fetchPreview as unknown as typeof fetch;

    const { unmount } = render(
      <FollowUpPreview
        followUpHref="/portal/app/call-center/follow-up"
        onCallback={() => {}}
        queueId="queue-1"
        refreshIntervalMs={20}
      />,
    );

    await waitFor(() => expect(screen.getByText("Patient One")).toBeTruthy());
    await waitFor(() => expect(getCount).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Mark Patient One resolved" }));
    await waitFor(() => expect(screen.queryByText("Patient One")).toBeNull());

    resolveStaleRead(Response.json({ items: [previewItem(0)], limit: 15 }));

    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(screen.queryByText("Patient One")).toBeNull());
    unmount();
  });
});
