import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FollowUpPreview from "./FollowUpPreview";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function previewItem(index: number, eventCount = 1) {
  const phone = `+15555550${index.toString().padStart(3, "0")}`;
  const activities = Array.from({ length: eventCount }, (_, activityIndex) => ({
    callerName: index === 0 ? "Patient One" : null,
    createdAt: new Date(
      Date.now() - index * 60_000 - activityIndex * 1_000,
    ).toISOString(),
    disposition: index % 3 === 2 ? "FOLLOW_UP_REQUIRED" : null,
    durationSec: index % 3 === 1 ? 24 : null,
    fromPhone: phone,
    kind: index % 3 === 0 ? "missed" : index % 3 === 1 ? "voicemail" : "note",
    locationId: "location-1",
    locationName: "Optical",
    queueId: "queue-1",
    recordingId: index % 3 === 1 ? `recording-${index}-${activityIndex}` : null,
    taskId: `task-${index}-${activityIndex}`,
  }));
  return {
    activities,
    callbackNeededCount: 0,
    callerName: index === 0 ? "Patient One" : null,
    eventCount,
    followUpRequiredCount: index % 3 === 2 ? eventCount : 0,
    fromPhone: phone,
    id: `needs-action:queue-1:location-1:${phone}`,
    lastActivityAt: activities[0]!.createdAt,
    latestKind: activities[0]!.kind,
    latestVoicemailDurationSec: index % 3 === 1 ? 24 : null,
    latestVoicemailRecordingId: index % 3 === 1 ? activities[0]!.recordingId : null,
    locationId: "location-1",
    locationNames: ["Optical"],
    missedCount: index % 3 === 0 ? eventCount : 0,
    noteCount: index % 3 === 2 ? eventCount : 0,
    queueId: "queue-1",
    taskIds: activities.map(({ taskId }) => taskId),
    voicemailCount: index % 3 === 1 ? eventCount : 0,
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
        items: Array.from({ length: resolved ? 14 : 15 }, (_, index) => {
          const itemIndex = index + (resolved ? 1 : 0);
          return previewItem(itemIndex, itemIndex === 0 ? 5 : 1);
        }),
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
    expect(screen.getByText("5 missed calls")).toBeTruthy();
    expect(screen.getAllByText("1 voicemail")).toHaveLength(5);
    expect(screen.getAllByText("1 follow-up required")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Show details for Patient One" }));
    expect(screen.getAllByText("Missed call")).toHaveLength(5);

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
        idempotencyKey: "resolve-preview:task-0-0",
        locationId: "location-1",
        phone: "+15555550000",
        queueId: "queue-1",
        taskIds: ["task-0-0", "task-0-1", "task-0-2", "task-0-3", "task-0-4"],
      }),
      method: "POST",
    });
  });

  it("resolves only the selected location thread in an all-location view", async () => {
    const requests: Array<RequestInit | undefined> = [];
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init);
      return init?.method === "POST"
        ? Response.json({ ok: true, resolvedCount: 1 })
        : Response.json({ items: [previewItem(0)], limit: 15 });
    }) as unknown as typeof fetch;

    render(
      <FollowUpPreview
        followUpHref="/portal/app/call-center/follow-up"
        onCallback={() => {}}
        queueId="queue-1"
      />,
    );

    await waitFor(() => expect(screen.getByText("Patient One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Mark Patient One resolved" }));
    await waitFor(() => expect(requests).toHaveLength(3));

    expect(requests[1]).toMatchObject({
      body: JSON.stringify({
        idempotencyKey: "resolve-preview:task-0-0",
        locationId: "location-1",
        phone: "+15555550000",
        queueId: "queue-1",
        taskIds: ["task-0-0"],
      }),
      method: "POST",
    });
  });

  it("refreshes a caller thread when new activity makes resolution stale", async () => {
    let reads = 0;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json(
          {
            error: {
              code: "SESSION_STALE",
              referenceId: "STALE1",
              retryable: false,
            },
          },
          { status: 409 },
        );
      }
      reads += 1;
      return Response.json({
        items: [previewItem(0, reads === 1 ? 1 : 2)],
        limit: 15,
      });
    }) as unknown as typeof fetch;

    render(
      <FollowUpPreview
        followUpHref="/portal/app/call-center/follow-up"
        onCallback={() => {}}
        queueId="queue-1"
      />,
    );

    await waitFor(() => expect(screen.getByText("1 missed call")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Mark Patient One resolved" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "New activity arrived for this caller. Review the refreshed thread before resolving.",
        ),
      ).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText("2 missed calls")).toBeTruthy());
    expect(reads).toBe(2);
  });

  it("plays a voicemail inline from expanded thread activity", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ items: [previewItem(1)], limit: 15 }),
    ) as unknown as typeof fetch;

    const { container } = render(
      <FollowUpPreview
        followUpHref="/portal/app/call-center/follow-up"
        onCallback={() => {}}
        queueId="queue-1"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Show details for (555) 555-0001",
        }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show details for (555) 555-0001",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Play voicemail from (555) 555-0001",
      }),
    );

    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      "/api/portal/call-center/voicemails/recording-1-0",
    );
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
    let resolveDeniedRead!: (response: Response) => void;
    const deniedRead = new Promise<Response>((resolve) => {
      resolveDeniedRead = resolve;
    });
    const fetchPreview = mock(async (_input: RequestInfo | URL) => {
      readCount += 1;
      if (readCount === 1) {
        return Response.json({ items: [previewItem(0)], limit: 15 });
      }
      return deniedRead;
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
    await waitFor(() => expect(readCount).toBe(2));
    await act(async () => {
      resolveDeniedRead(
        Response.json(
          {
            error: {
              code: "ACCESS_DENIED",
              referenceId: "ACCESS1",
              retryable: false,
            },
          },
          { status: 403 },
        ),
      );
      await deniedRead;
    });
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
    let postCount = 0;
    let resolvePost!: (response: Response) => void;
    let resolveStaleRead!: (response: Response) => void;
    const post = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const staleRead = new Promise<Response>((resolve) => {
      resolveStaleRead = resolve;
    });
    const fetchPreview = mock(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === "POST") {
          postCount += 1;
          return post;
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
    await waitFor(() => expect(postCount).toBe(1));
    await act(async () => {
      resolvePost(Response.json({ ok: true, resolvedCount: 1 }));
      await post;
    });
    await waitFor(() => expect(screen.queryByText("Patient One")).toBeNull());

    await act(async () => {
      resolveStaleRead(Response.json({ items: [previewItem(0)], limit: 15 }));
      await staleRead;
    });

    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(screen.queryByText("Patient One")).toBeNull());
    unmount();
  });
});
