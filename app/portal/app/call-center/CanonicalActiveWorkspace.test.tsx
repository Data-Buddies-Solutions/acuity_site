import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import type { AgentSessionView, CallView } from "@/lib/call-center/realtime-contract";

import {
  CanonicalActiveWorkspace,
  CanonicalActiveCall,
  CanonicalOfferAnswerButton,
  OperatorStateWarning,
} from "./CanonicalActiveWorkspace";
import { CallConnectionStatus } from "./CallConnectionStatus";
import { canonicalStartupConnectionState } from "./use-canonical-agent-session";
import type { useSoftphoneMedia } from "./use-softphone";

const originalFetch = globalThis.fetch;
type SoftphoneRuntimeValue = ReturnType<
  (typeof import("../SoftphoneRuntime"))["useSoftphoneRuntime"]
>;
let currentRuntime: SoftphoneRuntimeValue;

mock.module("../SoftphoneRuntime", () => ({
  useSoftphoneRuntime: () => currentRuntime,
}));

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function connectedCall(direction: CallView["direction"]): CallView {
  return {
    answeredAt: new Date().toISOString(),
    callOfficeLabel: null,
    callerName: null,
    direction,
    endedAt: null,
    fromPhone: "+19546097250",
    id: `call-${direction.toLowerCase()}`,
    legs: [
      {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        endpointLabel: null,
        id: "agent-leg-1",
        kind: "AGENT",
        providerCallControlId: "control-1",
        providerCallLegId: "provider-leg-1",
        providerCallSessionId: "provider-session-1",
        status: "BRIDGED",
      },
    ],
    onHold: false,
    transferring: false,
    queueId: "queue-1",
    receivedAt: "2026-07-10T15:43:20.000Z",
    stateVersion: 2,
    status: "CONNECTED",
    toPhone: "+19542872010",
    winningLegId: "agent-leg-1",
  };
}

function connectedOutboundCall(update: Partial<CallView> = {}): CallView {
  const call = connectedCall("OUTBOUND");
  return {
    ...call,
    legs: [
      {
        ...call.legs[0]!,
        endpointLabel: "Front Desk 1",
        status: "ANSWERED",
      },
    ],
    winningLegId: "agent-leg-1",
    ...update,
  };
}

function readySession(update: Partial<AgentSessionView> = {}): AgentSessionView {
  return {
    audioReady: true,
    clientInstanceId: "browser-1",
    connectionState: "READY",
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: "2026-07-14T12:01:00.000Z",
    microphoneReady: true,
    presence: "AVAILABLE",
    stateVersion: 1,
    ...update,
  };
}

function workspaceRuntime(
  update: Partial<Omit<SoftphoneRuntimeValue, "media">> & {
    media?: Partial<SoftphoneRuntimeValue["media"]>;
  } = {},
): SoftphoneRuntimeValue {
  const { media: mediaUpdate, ...runtimeUpdate } = update;
  return {
    answer: async () => {},
    answeringMediaLegId: null,
    availabilityError: null,
    availabilityIntent: "AVAILABLE",
    availabilityPending: false,
    availabilityRetryable: false,
    clientInstanceId: "browser-1",
    error: null,
    retryAvailability: async () => {},
    ringtone: {} as SoftphoneRuntimeValue["ringtone"],
    session: readySession(),
    setAvailability: async () => {},
    setOutboundOperationActive: () => {},
    takeover: async () => {},
    ...runtimeUpdate,
    media: {
      ...mediaControls(),
      microphoneError: null,
      observations: [],
      ...mediaUpdate,
    },
  };
}

function renderWorkspace(
  runtime: SoftphoneRuntimeValue,
  outboundNumbers: Array<{
    id: string;
    label: string;
    locationId: string | null;
    phoneNumber: string;
  }> = [],
  calls: CallView[] = [],
  selectedQueueCallIds: string[] = calls
    .filter(({ queueId }) => queueId === "queue-1")
    .map(({ id }) => id),
) {
  currentRuntime = runtime;
  globalThis.fetch = mock(async (input) =>
    String(input).includes("/snapshot?")
      ? Response.json({
          calls,
          observedAt: "2026-07-21T10:00:00.000Z",
          queueId: "queue-1",
          selectedQueueCallIds,
          schemaVersion: 9,
        })
      : Response.json({ items: [], limit: 15 }),
  ) as unknown as typeof fetch;

  return render(
    <CanonicalActiveWorkspace
      agentProfileLabel="Call Center 1"
      followUpHref="/follow-up"
      historyHref="/history"
      outboundNumbers={outboundNumbers}
      queueId="queue-1"
    />,
  );
}

describe("call readiness", () => {
  it("places canonical availability above dialer controls in the workspace", async () => {
    const setAvailability = mock(async (_presence: "AVAILABLE" | "PAUSED") => {});
    const runtime = workspaceRuntime({ setAvailability });
    renderWorkspace(runtime, [
      {
        id: "number-1",
        label: "Main",
        locationId: "location-1",
        phoneNumber: "+17865550100",
      },
    ]);

    await screen.findByText("No callers waiting. You're ready for calls.");
    const availability = screen.getByRole("group", { name: "Availability" });
    const dialer = screen.getByRole("textbox", { name: "Phone number" });
    expect(
      Boolean(
        availability.compareDocumentPosition(dialer) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unavailable" }));
    });
    expect(setAvailability).toHaveBeenCalledWith("PAUSED");
  });

  it("does not show Available while media readiness is lost", async () => {
    const runtime = workspaceRuntime({
      media: {
        microphoneReady: false,
      },
    });
    renderWorkspace(runtime);

    await screen.findByText("Allow microphone access to become Available.");
    await screen.findByText("No missed calls, voicemails, or follow-ups need action.");
    expect(screen.queryByText("No callers waiting. You're ready for calls.")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Available" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Unavailable" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("renders canonical paused and occupied states through the workspace", async () => {
    const paused = workspaceRuntime({
      availabilityIntent: "PAUSED",
      session: readySession({ presence: "PAUSED" }),
    });
    const view = renderWorkspace(paused);
    await screen.findByText("No callers waiting.");
    expect(
      screen.getByRole("button", { name: "Unavailable" }).getAttribute("aria-pressed"),
    ).toBe("true");

    const busy = workspaceRuntime({
      session: readySession({ presence: "BUSY" }),
    });
    currentRuntime = busy;
    view.rerender(
      <CanonicalActiveWorkspace
        agentProfileLabel="Call Center 1"
        followUpHref="/follow-up"
        historyHref="/history"
        outboundNumbers={[]}
        queueId="queue-1"
      />,
    );
    expect(screen.getByText("On a call")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Available" }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Unavailable" }).disabled,
    ).toBe(true);
  });

  it("retains a connected inbound call with seat, office, phone, and copy feedback", async () => {
    const copy = mock(async (_phone: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    const call = {
      ...connectedCall("INBOUND"),
      callOfficeLabel: "North Miami Beach Optical",
      callerName: "Hidden Patient",
      legs: [
        {
          ...connectedCall("INBOUND").legs[0]!,
          endpointLabel: "Front Desk 1",
        },
      ],
    } as CallView;

    renderWorkspace(workspaceRuntime(), [], [call]);

    await screen.findByText("Answered · Front Desk 1");
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Inbound")).toBeTruthy();
    expect(within(row).getByText("North Miami Beach Optical")).toBeTruthy();
    expect(within(row).getByText("(954) 609-7250")).toBeTruthy();
    expect(within(row).queryByText("Hidden Patient")).toBeNull();
    expect(within(row).queryByText(/\d\d:\d\d/)).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(row).getByRole("button", { name: "Copy caller phone number" }),
      );
    });
    expect(copy).toHaveBeenCalledWith("+19546097250");
    expect(within(row).getByRole("status").textContent).toContain("Phone number copied");
  });

  it("shows only connected outbound calls with canonical queue details and copy feedback", async () => {
    const copy = mock(async (_phone: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    const connected = connectedOutboundCall({
      callOfficeLabel: "North Miami Beach Optical",
      callerName: "Hidden Patient",
    });
    const created = structuredClone(connected);
    created.answeredAt = null;
    created.id = "call-outbound-created";
    created.status = "RECEIVED";
    created.legs[0]!.status = "CREATED";
    const dialing = structuredClone(connected);
    dialing.answeredAt = null;
    dialing.id = "call-outbound-dialing";
    dialing.status = "RINGING";
    dialing.legs[0]!.status = "DIALING";
    const ringing = structuredClone(connected);
    ringing.answeredAt = null;
    ringing.id = "call-outbound-ringing";
    ringing.status = "RINGING";
    ringing.legs[0]!.status = "RINGING";
    const completed = structuredClone(connected);
    completed.id = "call-outbound-completed";
    completed.status = "COMPLETED";
    completed.endedAt = "2026-07-21T10:01:00.000Z";

    renderWorkspace(
      workspaceRuntime(),
      [],
      [created, dialing, ringing, connected, completed],
    );

    await screen.findByText("Answered · Front Desk 1");
    const liveQueue = screen
      .getByRole("heading", { name: "Live queue" })
      .closest("section")!;
    expect(within(liveQueue).getByText("1")).toBeTruthy();
    const row = within(liveQueue).getByRole("listitem");
    expect(within(row).getByText("Outbound")).toBeTruthy();
    expect(within(row).getByText("North Miami Beach Optical")).toBeTruthy();
    expect(within(row).getByText("(954) 287-2010")).toBeTruthy();
    expect(within(row).queryByText("Hidden Patient")).toBeNull();
    expect(within(row).queryByText(/\d\d:\d\d/)).toBeNull();

    const copyButton = within(row).getByRole("button", {
      name: "Copy recipient phone number",
    });
    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);
    await act(async () => {
      fireEvent.click(copyButton, { detail: 0 });
    });
    expect(copy).toHaveBeenCalledWith("+19542872010");
    expect(within(row).getByRole("status").textContent).toContain("Phone number copied");
  });

  it("keeps held inbound and outbound details and restores both rows on Resume", async () => {
    const inbound = connectedCall("INBOUND");
    inbound.callOfficeLabel = "Hollywood Optical";
    inbound.legs[0]!.endpointLabel = "Front Desk 1";
    inbound.onHold = true;

    const outbound = connectedOutboundCall({
      callOfficeLabel: "Sweetwater Optical",
      id: "call-outbound-held",
    });
    outbound.onHold = true;

    renderWorkspace(workspaceRuntime(), [], [inbound, outbound]);

    expect(await screen.findAllByText("On hold · Front Desk 1")).toHaveLength(2);
    const liveQueue = screen
      .getByRole("heading", { name: "Live queue" })
      .closest("section")!;
    const rows = within(liveQueue).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Inbound")).toBeTruthy();
    expect(within(rows[0]!).getByText("Hollywood Optical")).toBeTruthy();
    expect(within(rows[0]!).getByText("(954) 609-7250")).toBeTruthy();
    expect(within(rows[1]!).getByText("Outbound")).toBeTruthy();
    expect(within(rows[1]!).getByText("Sweetwater Optical")).toBeTruthy();
    expect(within(rows[1]!).getByText("(954) 287-2010")).toBeTruthy();
    expect(screen.getByText("On a call")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Unavailable" }).disabled,
    ).toBe(true);

    cleanup();
    const resumedInbound = structuredClone(inbound);
    resumedInbound.onHold = false;
    const resumedOutbound = structuredClone(outbound);
    resumedOutbound.onHold = false;
    renderWorkspace(workspaceRuntime(), [], [resumedInbound, resumedOutbound]);
    expect(await screen.findAllByText("Answered · Front Desk 1")).toHaveLength(2);
    expect(screen.queryByText(/On hold/)).toBeNull();
  });

  it("keeps transferring inbound and outbound details with Busy availability", async () => {
    const inbound = connectedCall("INBOUND");
    inbound.callOfficeLabel = "Hollywood Optical";
    inbound.legs[0]!.endpointLabel = "Front Desk 1";
    inbound.transferring = true;

    const outbound = connectedOutboundCall({
      callOfficeLabel: "Sweetwater Optical",
      id: "call-outbound-transferring",
      transferring: true,
    });

    renderWorkspace(workspaceRuntime(), [], [inbound, outbound]);

    expect(await screen.findAllByText("Transferring · Front Desk 1")).toHaveLength(2);
    const liveQueue = screen
      .getByRole("heading", { name: "Live queue" })
      .closest("section")!;
    const rows = within(liveQueue).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Inbound")).toBeTruthy();
    expect(within(rows[0]!).getByText("Hollywood Optical")).toBeTruthy();
    expect(within(rows[0]!).getByText("(954) 609-7250")).toBeTruthy();
    expect(within(rows[1]!).getByText("Outbound")).toBeTruthy();
    expect(within(rows[1]!).getByText("Sweetwater Optical")).toBeTruthy();
    expect(within(rows[1]!).getByText("(954) 287-2010")).toBeTruthy();
    expect(screen.getByText("On a call")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Unavailable" }).disabled,
    ).toBe(true);

    cleanup();
    const successful = structuredClone(inbound);
    successful.transferring = false;
    successful.legs[0]!.status = "ENDED";
    successful.legs.push({
      ...successful.legs[0]!,
      agentSessionId: "session-2",
      endpointId: "endpoint-2",
      endpointLabel: "Front Desk 2",
      id: "target-leg",
      status: "BRIDGED",
    });
    successful.winningLegId = "target-leg";
    renderWorkspace(workspaceRuntime(), [], [successful]);
    await screen.findByText("Answered · Front Desk 2");
    expect(
      within(
        screen.getByRole("heading", { name: "Live queue" }).closest("section")!,
      ).getAllByRole("listitem"),
    ).toHaveLength(1);

    cleanup();
    const failed = structuredClone(inbound);
    failed.transferring = false;
    failed.legs.push({
      ...failed.legs[0]!,
      agentSessionId: "session-2",
      endpointId: "endpoint-2",
      endpointLabel: "Front Desk 2",
      id: "failed-target-leg",
      status: "RINGING",
    });
    const connectedMedia = mediaControls();
    renderWorkspace(
      workspaceRuntime({ media: { observations: connectedMedia.observations } }),
      [],
      [failed],
    );
    await screen.findByText("Answered · Front Desk 1");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "End" }).disabled).toBe(
      false,
    );

    cleanup();
    const ended = structuredClone(inbound);
    ended.endedAt = "2026-07-21T10:01:00.000Z";
    ended.status = "COMPLETED";
    renderWorkspace(workspaceRuntime(), [], [ended]);
    await screen.findByText("No callers waiting. You're ready for calls.");
    expect(
      within(
        screen.getByRole("heading", { name: "Live queue" }).closest("section")!,
      ).queryByRole("listitem"),
    ).toBeNull();
  });

  it("reconstructs hold after reconnect, returns to Answered on Resume, and removes the ended row", async () => {
    const held = connectedCall("INBOUND");
    held.legs[0]!.endpointLabel = "Front Desk 1";
    held.onHold = true;

    renderWorkspace(workspaceRuntime(), [], [held]);
    await screen.findByText("On hold · Front Desk 1");

    cleanup();
    const resumed = structuredClone(held);
    resumed.onHold = false;
    renderWorkspace(workspaceRuntime(), [], [resumed]);
    await screen.findByText("Answered · Front Desk 1");
    expect(screen.queryByText(/On hold/)).toBeNull();

    cleanup();
    const ended = structuredClone(held);
    ended.endedAt = "2026-07-21T10:01:00.000Z";
    ended.status = "COMPLETED";
    renderWorkspace(workspaceRuntime(), [], [ended]);
    await screen.findByText("No callers waiting. You're ready for calls.");
    const liveQueue = screen
      .getByRole("heading", { name: "Live queue" })
      .closest("section")!;
    expect(within(liveQueue).queryByRole("listitem")).toBeNull();
  });

  it("fails closed without authorized queue visibility or one owning seat", async () => {
    const missingWinner = connectedOutboundCall();
    missingWinner.winningLegId = null;
    missingWinner.legs.push({
      ...missingWinner.legs[0]!,
      agentSessionId: "session-2",
      endpointId: "endpoint-2",
      endpointLabel: "Front Desk 2",
      id: "agent-leg-2",
    });
    const unauthorizedWinner = structuredClone(missingWinner);
    unauthorizedWinner.id = "call-outbound-unauthorized-winner";
    unauthorizedWinner.winningLegId = unauthorizedWinner.legs[0]!.id;
    unauthorizedWinner.legs[0]!.endpointLabel = null;
    const otherQueue = structuredClone(missingWinner);
    otherQueue.id = "call-outbound-other-queue";
    otherQueue.queueId = "queue-2";
    otherQueue.winningLegId = otherQueue.legs[0]!.id;
    const unauthorizedLocation = connectedOutboundCall({
      id: "call-outbound-unauthorized-location",
    });

    renderWorkspace(
      workspaceRuntime(),
      [],
      [missingWinner, unauthorizedWinner, otherQueue, unauthorizedLocation],
      [missingWinner.id, unauthorizedWinner.id],
    );

    await screen.findByText("No callers waiting. You're ready for calls.");
    const liveQueue = screen
      .getByRole("heading", { name: "Live queue" })
      .closest("section")!;
    expect(within(liveQueue).getByText("0")).toBeTruthy();
    expect(within(liveQueue).queryByRole("listitem")).toBeNull();
  });

  it("does not invent an outbound owner without a canonical winning leg", async () => {
    const call = connectedOutboundCall();
    call.winningLegId = null;

    renderWorkspace(workspaceRuntime(), [], [call], [call.id]);

    await screen.findByText("No callers waiting. You're ready for calls.");
    const liveQueue = screen
      .getByRole("heading", { name: "Live queue" })
      .closest("section")!;
    expect(within(liveQueue).queryByText("(954) 287-2010")).toBeNull();
  });

  it("keeps mixed snapshot ordering and removes outbound rows after termination", async () => {
    const inbound = connectedCall("INBOUND");
    inbound.id = "call-inbound-first";
    inbound.receivedAt = "2026-07-21T10:00:00.000Z";
    inbound.legs[0]!.endpointLabel = "Front Desk 2";
    const outbound = connectedOutboundCall();
    outbound.id = "call-outbound-second";
    outbound.receivedAt = "2026-07-21T10:01:00.000Z";
    let snapshotReads = 0;
    globalThis.fetch = mock(async (input) => {
      if (!String(input).includes("/snapshot?")) {
        return Response.json({ items: [], limit: 15 });
      }
      snapshotReads += 1;
      const calls = snapshotReads === 1 ? [inbound, outbound] : [inbound];
      return Response.json({
        calls,
        observedAt: `2026-07-21T10:00:0${snapshotReads}.000Z`,
        queueId: "queue-1",
        selectedQueueCallIds: calls.map(({ id }) => id),
        schemaVersion: 9,
      });
    }) as unknown as typeof fetch;

    currentRuntime = workspaceRuntime();
    render(
      <CanonicalActiveWorkspace
        agentProfileLabel="Call Center 1"
        followUpHref="/follow-up"
        historyHref="/history"
        outboundNumbers={[]}
        queueId="queue-1"
      />,
    );

    await screen.findByText("Answered · Front Desk 1");
    const liveQueue = screen
      .getByRole("heading", { name: "Live queue" })
      .closest("section")!;
    expect(
      within(liveQueue)
        .getAllByRole("listitem")
        .map((row) => within(row).getByText(/Inbound|Outbound/).textContent),
    ).toEqual(["Inbound", "Outbound"]);

    await waitFor(
      () => expect(within(liveQueue).getAllByRole("listitem")).toHaveLength(1),
      { timeout: 3_000 },
    );
    expect(within(liveQueue).queryByText("Outbound")).toBeNull();
  });

  it("reports a failed phone copy without claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mock(async () => Promise.reject(new Error("denied"))) },
    });
    renderWorkspace(workspaceRuntime(), [], [connectedCall("INBOUND")]);

    const row = await screen.findByRole("listitem");
    fireEvent.click(
      within(row).getByRole("button", { name: "Copy caller phone number" }),
    );

    expect(
      await screen.findByText("Phone number could not be copied. Try again."),
    ).toBeTruthy();
    expect(within(row).queryByText("Phone number copied")).toBeNull();
  });

  it("hides a connected inbound call without an exact winning bridged seat", async () => {
    const call = connectedCall("INBOUND");
    call.winningLegId = null;
    call.legs[0]!.status = "ANSWERED";

    renderWorkspace(workspaceRuntime(), [], [call]);

    await screen.findByText("No callers waiting. You're ready for calls.");
    expect(screen.queryByText("(954) 609-7250")).toBeNull();
  });

  it("shows canonical answer evidence with the answering endpoint seat", async () => {
    const call = connectedCall("INBOUND");
    call.answeredAt = null;
    call.status = "RINGING";
    call.winningLegId = null;
    call.legs = [
      {
        ...call.legs[0]!,
        agentSessionId: "session-2",
        endpointId: "endpoint-2",
        endpointLabel: "Front Desk 2",
        status: "ANSWERED",
      },
    ];

    renderWorkspace(workspaceRuntime(), [], [call]);

    await screen.findByText("Answering · Front Desk 2");
    const row = screen.getByRole("listitem");
    expect(within(row).queryByRole("button", { name: "Answer" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("fails closed when concurrent answer evidence has no canonical winner", async () => {
    const call = connectedCall("INBOUND");
    call.answeredAt = null;
    call.status = "RINGING";
    call.winningLegId = null;
    call.legs = [
      {
        ...call.legs[0]!,
        agentSessionId: "session-2",
        endpointId: "endpoint-2",
        endpointLabel: "Front Desk 2",
        id: "agent-leg-2",
        status: "ANSWERED",
      },
      {
        ...call.legs[0]!,
        agentSessionId: "session-3",
        endpointId: "endpoint-3",
        endpointLabel: null,
        id: "agent-leg-3",
        status: "ANSWERED",
      },
    ];

    renderWorkspace(workspaceRuntime(), [], [call]);

    await screen.findByText("Ringing");
    const row = screen.getByRole("listitem");
    expect(within(row).queryByText(/Answering/)).toBeNull();
    expect(within(row).queryByText(/Front Desk/)).toBeNull();
  });

  it("keeps Answer and Decline only on the viewer's exact ringing offer", async () => {
    const exact = connectedCall("INBOUND");
    exact.answeredAt = null;
    exact.status = "RINGING";
    exact.winningLegId = null;
    exact.legs[0]!.status = "RINGING";

    const teammate = structuredClone(exact);
    teammate.fromPhone = "+17865550199";
    teammate.id = "call-teammate";
    teammate.legs[0] = {
      ...teammate.legs[0]!,
      agentSessionId: "session-2",
      endpointId: "endpoint-2",
      id: "agent-leg-2",
      providerCallControlId: "control-2",
      providerCallLegId: "provider-leg-2",
      providerCallSessionId: "provider-session-2",
    };

    renderWorkspace(
      workspaceRuntime({ media: mediaControls("RINGING") }),
      [],
      [exact, teammate],
    );

    await screen.findByText("(786) 555-0199");
    const exactRow = screen.getByText("(954) 609-7250").closest("li")!;
    const teammateRow = screen.getByText("(786) 555-0199").closest("li")!;
    expect(within(exactRow).getByRole("button", { name: "Answer" })).toBeTruthy();
    expect(within(exactRow).getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(within(teammateRow).queryByRole("button", { name: "Answer" })).toBeNull();
    expect(within(teammateRow).queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("keeps shared source ownership with Answer and Decline on an exact transfer offer", async () => {
    const call = connectedCall("OUTBOUND");
    call.transferring = true;
    call.winningLegId = "source-leg";
    call.legs = [
      {
        ...call.legs[0]!,
        agentSessionId: "source-session",
        endpointId: "source-endpoint",
        endpointLabel: "Front Desk 1",
        id: "source-leg",
        providerCallControlId: "source-control",
        providerCallLegId: "source-provider-leg",
        status: "BRIDGED",
      },
      {
        ...call.legs[0]!,
        agentSessionId: "session-2",
        endpointId: "endpoint-2",
        id: "transfer-leg",
        status: "RINGING",
      },
    ];

    renderWorkspace(
      workspaceRuntime({
        media: mediaControls("RINGING"),
        session: readySession({ endpointId: "endpoint-2", id: "session-2" }),
      }),
      [],
      [call],
    );

    await screen.findByText("Transferring · Front Desk 1");
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Outbound")).toBeTruthy();
    expect(within(row).queryByText("Answered")).toBeNull();
    expect(within(row).getByRole("button", { name: "Answer" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Decline" })).toBeTruthy();
  });

  it("returns a failed answer attempt to the canonical ringing presentation", async () => {
    const call = connectedCall("INBOUND");
    call.answeredAt = null;
    call.status = "RINGING";
    call.winningLegId = null;
    call.legs = [
      {
        ...call.legs[0]!,
        agentSessionId: "session-2",
        endpointId: "endpoint-2",
        endpointLabel: "Front Desk 2",
        status: "FAILED",
      },
    ];

    renderWorkspace(workspaceRuntime(), [], [call]);

    await screen.findByText("Ringing");
    const row = screen.getByRole("listitem");
    expect(within(row).queryByText(/Answering/)).toBeNull();
    expect(within(row).queryByText("Front Desk 2")).toBeNull();
  });

  it("uses only the canonical winning endpoint after concurrent answers", async () => {
    const call = connectedCall("INBOUND");
    call.winningLegId = "agent-leg-3";
    call.legs = [
      {
        ...call.legs[0]!,
        endpointLabel: "Front Desk 2",
        id: "agent-leg-2",
        status: "ANSWERED",
      },
      {
        ...call.legs[0]!,
        agentSessionId: "session-3",
        endpointId: "endpoint-3",
        endpointLabel: "Front Desk 3",
        id: "agent-leg-3",
        providerCallControlId: "control-3",
        providerCallLegId: "provider-leg-3",
        status: "BRIDGED",
      },
    ];

    renderWorkspace(workspaceRuntime(), [], [call]);

    await screen.findByText("Answered · Front Desk 3");
    const row = screen.getByRole("listitem");
    expect(within(row).queryByText("Front Desk 2")).toBeNull();
  });

  it("counts every live inbound lifecycle and excludes terminal outcomes", async () => {
    const statuses: CallView["status"][] = [
      "RECEIVED",
      "QUEUED",
      "RINGING",
      "CONNECTED",
      "COMPLETED",
      "ABANDONED",
      "FAILED",
      "VOICEMAIL",
    ];
    const calls = statuses.map((status, index) => {
      const call = connectedCall("INBOUND");
      call.id = `call-${status.toLowerCase()}`;
      call.fromPhone = `+1786555010${index}`;
      call.status = status;
      if (status !== "CONNECTED") {
        call.answeredAt = null;
        call.winningLegId = null;
        call.legs[0]!.status = "RINGING";
      }
      return call;
    });

    renderWorkspace(workspaceRuntime(), [], calls);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
    const liveQueue = screen
      .getByRole("heading", { name: "Live queue" })
      .closest("section")!;
    expect(within(liveQueue).getByText("4")).toBeTruthy();
  });

  it("exposes pending and retry states through the workspace", async () => {
    const retry = mock(async () => {});
    const view = renderWorkspace(
      workspaceRuntime({ availabilityPending: true, retryAvailability: retry }),
    );
    await screen.findByText("No callers waiting. You're ready for calls.");
    expect(screen.getByText("Updating availability…")).toBeTruthy();

    currentRuntime = workspaceRuntime({
      availabilityError: "The call center is temporarily unavailable.",
      availabilityRetryable: true,
      retryAvailability: retry,
    });
    view.rerender(
      <CanonicalActiveWorkspace
        agentProfileLabel="Call Center 1"
        followUpHref="/follow-up"
        historyHref="/history"
        outboundNumbers={[]}
        queueId="queue-1"
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "The call center is temporarily unavailable.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("reports automatic startup as connecting instead of trying to release", () => {
    expect(
      canonicalStartupConnectionState({
        audioReady: false,
        connectionState: "CLOSED",
        microphoneReady: false,
        presence: "PAUSED",
      }),
    ).toBe("CONNECTING");
    expect(
      canonicalStartupConnectionState({
        audioReady: false,
        connectionState: "CLOSED",
        microphoneReady: false,
        presence: "OFFLINE",
      }),
    ).toBe("CLOSED");
  });

  it("renders one durable connection status with no readiness control", () => {
    const view = render(<CallConnectionStatus connectionState="OFFLINE" />);

    expect(screen.getByRole("status").textContent).toBe(
      "Phone disconnected — reconnecting",
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    view.rerender(<CallConnectionStatus connectionState="READY" />);
    expect(screen.getByRole("status").textContent).toBe("Connected");

    view.rerender(<CallConnectionStatus connectionState="READY" restoring />);
    expect(screen.getByRole("status").textContent).toBe("Restoring calling…");

    view.rerender(<CallConnectionStatus connectionState="CONNECTING" />);
    expect(screen.getByRole("status").textContent).toBe("Phone connecting…");

    view.rerender(<CallConnectionStatus connectionState="FAILED" />);
    expect(screen.getByRole("status").textContent).toBe(
      "Phone disconnected — reconnecting",
    );
  });

  it("keeps stale operator state visibly distinct from phone registration", () => {
    const retry = mock(() => {});
    render(
      <OperatorStateWarning
        failedAt="2026-07-19T10:01:05.000Z"
        observedAt="2026-07-19T10:00:00.000Z"
        retry={retry}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Last updated 1m ago. Retained calls may be stale.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

function mediaControls(state: "ACTIVE" | "HELD" | "RINGING" = "ACTIVE") {
  const observation = {
    connectionId: "connection-1",
    direction: "INBOUND" as const,
    mediaLegId: "media-leg-1",
    providerCallControlId: "control-1",
    providerCallLegId: "provider-leg-1",
    providerCallSessionId: "provider-session-1",
    remoteAudioReady: true,
    state,
  };
  const controls = {
    activate: mock(() => {}),
    answer: mock(async () => {}),
    connection: "READY" as const,
    dial: mock(() => "media-leg-1"),
    dtmf: mock((_mediaLegId: string, _digit: string) => {}),
    error: null,
    hangup: mock(async () => {}),
    hold: mock(async (_mediaLegId: string, _held: boolean) => true),
    microphoneReady: true,
    mute: mock(() => {}),
    observations: [observation],
    soundReady: true,
  };

  return controls as typeof controls & ReturnType<typeof useSoftphoneMedia>;
}

function withMediaState(
  media: ReturnType<typeof mediaControls>,
  state: "ACTIVE" | "HELD",
) {
  return {
    ...media,
    observations: media.observations.map((observation) => ({
      ...observation,
      state,
    })),
  };
}

describe("canonical offer Answer", () => {
  it("answers a transfer offer without claiming the connected call as inbound", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("transfer offers must not use the inbound Answer claim");
    }) as unknown as typeof fetch;
    const answer = mock(async () => {});

    render(
      <CanonicalOfferAnswerButton
        answer={answer}
        answering={false}
        callId="call-1"
        connectionState="READY"
        disabled={false}
        legId="leg-1"
        mediaLegId="media-leg-1"
        sessionId="session-1"
        transferOffer
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });

    expect(answer).toHaveBeenCalledWith("media-leg-1");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("persists the Answer claim before invoking provider media", async () => {
    const order: string[] = [];
    globalThis.fetch = mock(async () => {
      order.push("claim");
      return Response.json(
        {
          replayed: false,
          reservation: { id: "reservation-1" },
          status: "ACCEPTED",
        },
        { status: 202 },
      );
    }) as unknown as typeof fetch;
    const answer = mock(async () => {
      order.push("provider-answer");
    });

    render(
      <CanonicalOfferAnswerButton
        answer={answer}
        answering={false}
        callId="call-1"
        connectionState="READY"
        disabled={false}
        legId="leg-1"
        mediaLegId="media-leg-1"
        sessionId="session-1"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });

    expect(order).toEqual(["claim", "provider-answer"]);
    expect(answer).toHaveBeenCalledWith("media-leg-1");
  });

  it("allows a fresh claim after a rejected attempt", async () => {
    const keys: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return Response.json(
        {
          callId: "call-1",
          legId: "leg-1",
          reason: "ANSWER_IN_PROGRESS",
          status: "REJECTED",
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;
    const answer = mock(async () => {});

    render(
      <CanonicalOfferAnswerButton
        answer={answer}
        answering={false}
        callId="call-1"
        connectionState="READY"
        disabled={false}
        legId="leg-1"
        mediaLegId="media-leg-1"
        sessionId="session-1"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });

    expect(answer).not.toHaveBeenCalled();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(screen.getByRole("alert").textContent).toContain("Call ended");
  });

  it("releases the reservation and allows a fresh claim when provider Answer fails", async () => {
    const order: string[] = [];
    const keys: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "DELETE") {
        order.push("release");
        return Response.json({ released: true, status: "RELEASED" });
      }
      order.push("claim");
      keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return Response.json(
        {
          replayed: false,
          reservation: { id: "reservation-1" },
          status: "ACCEPTED",
        },
        { status: 202 },
      );
    }) as unknown as typeof fetch;
    const answer = mock(async () => {
      order.push("provider-answer");
      throw new Error("provider failed");
    });

    render(
      <CanonicalOfferAnswerButton
        answer={answer}
        answering={false}
        callId="call-1"
        connectionState="READY"
        disabled={false}
        legId="leg-1"
        mediaLegId="media-leg-1"
        sessionId="session-1"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });

    expect(order).toEqual(["claim", "provider-answer", "release"]);
    expect(screen.getByRole("alert").textContent).toContain("answer this call");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });
    expect(order).toEqual([
      "claim",
      "provider-answer",
      "release",
      "claim",
      "provider-answer",
      "release",
    ]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("releases an accepted reservation when the browser disconnects", async () => {
    const requests: RequestInit[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      requests.push(init ?? {});
      return init?.method === "DELETE"
        ? Response.json({ released: true, status: "RELEASED" })
        : Response.json(
            {
              replayed: false,
              reservation: { id: "reservation-1" },
              status: "ACCEPTED",
            },
            { status: 202 },
          );
    }) as unknown as typeof fetch;
    const view = render(
      <CanonicalOfferAnswerButton
        answer={mock(async () => {})}
        answering={false}
        callId="call-1"
        connectionState="READY"
        disabled={false}
        legId="leg-1"
        mediaLegId="media-leg-1"
        sessionId="session-1"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });

    view.unmount();

    await waitFor(() =>
      expect(requests.some(({ method }) => method === "DELETE")).toBe(true),
    );
    const release = requests.find(({ method }) => method === "DELETE");
    expect(JSON.parse(String(release?.body))).toMatchObject({
      failureCode: "BROWSER_DISCONNECTED",
      legId: "leg-1",
      sessionId: "session-1",
    });
  });

  it("releases an accepted reservation when media disconnects", async () => {
    const requests: RequestInit[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      requests.push(init ?? {});
      return init?.method === "DELETE"
        ? Response.json({ released: true, status: "RELEASED" })
        : Response.json(
            {
              replayed: false,
              reservation: { id: "reservation-1" },
              status: "ACCEPTED",
            },
            { status: 202 },
          );
    }) as unknown as typeof fetch;
    const view = render(
      <CanonicalOfferAnswerButton
        answer={mock(async () => {})}
        answering={false}
        callId="call-1"
        connectionState="READY"
        disabled={false}
        legId="leg-1"
        mediaLegId="media-leg-1"
        sessionId="session-1"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });
    view.rerender(
      <CanonicalOfferAnswerButton
        answer={mock(async () => {})}
        answering
        callId="call-1"
        connectionState="FAILED"
        disabled
        legId="leg-1"
        mediaLegId="media-leg-1"
        sessionId="session-1"
      />,
    );

    await waitFor(() =>
      expect(requests.some(({ method }) => method === "DELETE")).toBe(true),
    );
    const release = requests.find(({ method }) => method === "DELETE");
    expect(JSON.parse(String(release?.body))).toMatchObject({
      failureCode: "BROWSER_DISCONNECTED",
      legId: "leg-1",
      sessionId: "session-1",
    });
  });

  it("uses a new operation key when the exact offer identity changes", async () => {
    const keys: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      keys.push(String((init?.headers as Record<string, string>)["Idempotency-Key"]));
      return Response.json(
        {
          callId: "call-1",
          legId: "leg-1",
          reason: "STALE_OFFER",
          status: "REJECTED",
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;
    const view = render(
      <CanonicalOfferAnswerButton
        answer={mock(async () => {})}
        answering={false}
        callId="call-1"
        connectionState="READY"
        disabled={false}
        legId="leg-1"
        mediaLegId="media-leg-1"
        sessionId="session-1"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });
    view.rerender(
      <CanonicalOfferAnswerButton
        answer={mock(async () => {})}
        answering={false}
        callId="call-1"
        connectionState="READY"
        disabled={false}
        legId="leg-2"
        mediaLegId="media-leg-2"
        sessionId="session-2"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    });

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("CanonicalActiveCall", () => {
  it("answers the initiating agent leg when the outbound customer connects", async () => {
    const call = connectedCall("OUTBOUND");
    call.answeredAt = null;
    call.status = "RINGING";
    call.winningLegId = null;
    call.legs[0]!.status = "RINGING";
    const media = mediaControls("RINGING");

    render(
      <CanonicalActiveCall
        call={call}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await waitFor(() => {
      expect(media.answer).toHaveBeenCalledWith("media-leg-1");
    });
  });

  it("surfaces one outbound auto-answer failure without retrying in a render loop", async () => {
    const call = connectedCall("OUTBOUND");
    call.answeredAt = null;
    call.status = "RINGING";
    call.winningLegId = null;
    call.legs[0]!.status = "RINGING";
    const media = mediaControls("RINGING");
    media.answer.mockRejectedValueOnce(new Error("answer rejected"));

    render(
      <CanonicalActiveCall
        call={call}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await screen.findByText(/couldn't answer this call/i);
    expect(media.answer).toHaveBeenCalledTimes(1);
  });

  it("sends dial pad input through the active media leg", () => {
    const media = mediaControls();

    render(
      <CanonicalActiveCall
        call={connectedCall("OUTBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keypad" }));
    fireEvent.click(screen.getByRole("button", { name: "Send 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Send #" }));

    expect(media.dtmf.mock.calls).toEqual([
      ["media-leg-1", "1"],
      ["media-leg-1", "#"],
    ]);
  });

  it("restores connected inbound controls and routes them through canonical media", async () => {
    const media = mediaControls();

    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    expect(screen.getByText("(954) 609-7250")).toBeTruthy();
    expect(screen.getByText("Patient call")).toBeTruthy();
    expect(screen.getByText("00:00")).toBeTruthy();
    for (const name of ["Mute", "Hold", "Transfer", "End"]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-w-0");
      expect(screen.getByRole("button", { name }).className).toContain("w-full");
      expect(screen.getByRole("button", { name }).className).toContain(
        "@min-[30rem]/active-call:px-2",
      );
    }
    expect(
      screen.getByRole("button", { name: "Mute" }).parentElement?.className,
    ).toContain("@min-[30rem]/active-call:grid-cols-5");

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(media.mute).toHaveBeenCalledWith("media-leg-1", true);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();

    const fetchEnd = mock(async () => new Response("{}", { status: 202 }));
    globalThis.fetch = fetchEnd as never;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });
    expect(fetchEnd).not.toHaveBeenCalled();
    expect(media.hangup).toHaveBeenCalledWith("media-leg-1");
  });

  it("holds media with caller music and stops music before resuming", async () => {
    const media = mediaControls();
    const requests: Array<{
      action: string;
      idempotencyKey: string | null;
      url: string;
    }> = [];
    globalThis.fetch = mock(async (input, init) => {
      requests.push({
        action: JSON.parse(String(init?.body)).action,
        idempotencyKey: new Headers(init?.headers).get("Idempotency-Key"),
        url: String(input),
      });
      return Response.json({ status: "CONFIRMED" }, { status: 202 });
    }) as unknown as typeof fetch;

    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    });
    expect(media.hold).toHaveBeenCalledWith("media-leg-1", true);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });
    expect(media.hold).toHaveBeenCalledWith("media-leg-1", false);
    expect(screen.getByRole("button", { name: "Hold" })).toBeTruthy();
    expect(requests.map(({ action }) => action)).toEqual(["START", "STOP"]);
    expect(requests[0]?.url).toBe(
      "/api/portal/call-center/calls/call-inbound/hold-music",
    );
    expect(
      requests.every(({ idempotencyKey }) =>
        idempotencyKey?.startsWith("hold-music:call-inbound:"),
      ),
    ).toBe(true);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  });

  it("keeps resume available for a held outbound call", () => {
    const call = connectedCall("OUTBOUND");
    call.legs[0]!.status = "ANSWERED";
    call.winningLegId = null;

    render(
      <CanonicalActiveCall
        call={call}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={mediaControls("HELD")}
        sessionId="session-1"
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Resume" }).disabled,
    ).toBe(false);
  });

  it("returns to provider state after the media connection is recovered", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ status: "CONFIRMED" }, { status: 202 }),
    ) as unknown as typeof fetch;
    const media = mediaControls();
    const view = render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    });
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();

    view.rerender(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={{
          ...media,
          connection: "CONNECTING",
          observations: media.observations.map((observation) => ({
            ...observation,
            state: "ACTIVE",
          })),
        }}
        sessionId="session-1"
      />,
    );
    expect(screen.getByRole("button", { name: "Hold" })).toBeTruthy();

    view.rerender(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={withMediaState(media, "ACTIVE")}
        sessionId="session-1"
      />,
    );
    expect(screen.getByRole("button", { name: "Hold" })).toBeTruthy();
  });

  it("ignores a stale resume completion after media recovery", async () => {
    let finishStop: ((response: Response) => void) | null = null;
    globalThis.fetch = mock(
      async () =>
        new Promise<Response>((resolve) => {
          finishStop = resolve;
        }),
    ) as unknown as typeof fetch;
    const media = mediaControls("HELD");
    const view = render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await act(async () => Promise.resolve());

    view.rerender(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={{ ...media, connection: "CONNECTING" }}
        sessionId="session-1"
      />,
    );
    view.rerender(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      finishStop?.(Response.json({ status: "CONFIRMED" }, { status: 202 }));
      await Promise.resolve();
    });
    expect(media.hold).toHaveBeenCalledWith("media-leg-1", false);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("surfaces a failed hold-music restart when resume cannot unhold", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return requestCount === 1
        ? Response.json({ status: "DISPATCHED" }, { status: 202 })
        : Response.json(
            {
              error: {
                code: "PROVIDER_UNAVAILABLE",
                referenceId: "RESTART1",
                retryable: true,
              },
            },
            { status: 503 },
          );
    }) as unknown as typeof fetch;
    const media = mediaControls("HELD");
    media.hold.mockRejectedValue(new Error("unhold failed"));

    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });

    expect(requestCount).toBe(2);
    expect(screen.getByRole("alert").textContent).toContain("RESTART1");
  });

  it("keeps end available while a hold update is pending", async () => {
    let finishRequest: ((response: Response) => void) | null = null;
    globalThis.fetch = mock(
      async () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    ) as unknown as typeof fetch;

    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={mediaControls()}
        sessionId="session-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    await act(async () => Promise.resolve());
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Resume" }).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Updating" })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "End" }).disabled).toBe(
      false,
    );

    await act(async () => {
      finishRequest?.(Response.json({ status: "CONFIRMED" }, { status: 202 }));
      await Promise.resolve();
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Resume" }).disabled,
    ).toBe(false);
  });

  it("shows resume when hold-music rollback cannot unhold the provider call", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return requestCount === 1
        ? Response.json(
            {
              error: {
                code: "PROVIDER_UNAVAILABLE",
                referenceId: "ABC123",
                retryable: true,
              },
            },
            { status: 503 },
          )
        : Response.json({ status: "CONFIRMED" }, { status: 202 });
    }) as unknown as typeof fetch;
    const media = mediaControls();
    media.hold.mockImplementation(async (_mediaLegId, held) => {
      if (!held) throw new Error("unhold failed");
      return true;
    });

    const view = render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    });

    expect(media.hold).toHaveBeenNthCalledWith(1, "media-leg-1", true);
    expect(media.hold).toHaveBeenNthCalledWith(2, "media-leg-1", false);
    view.rerender(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={withMediaState(media, "HELD")}
        sessionId="session-1"
      />,
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("keeps the call held when failed hold music cannot be stopped", async () => {
    globalThis.fetch = mock(async () =>
      Response.json(
        {
          error: {
            code: "PROVIDER_UNAVAILABLE",
            referenceId: "ABC123",
            retryable: true,
          },
        },
        { status: 503 },
      ),
    ) as unknown as typeof fetch;
    const media = mediaControls();

    const view = render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    });

    expect(media.hold).toHaveBeenCalledTimes(1);
    expect(media.hold).toHaveBeenCalledWith("media-leg-1", true);
    view.rerender(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={withMediaState(media, "HELD")}
        sessionId="session-1"
      />,
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("unholds directly when stale state prevents hold music from starting", async () => {
    const requests: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)).action);
      return Response.json(
        {
          error: {
            code: "SESSION_STALE",
            referenceId: "ABC123",
            retryable: true,
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;
    const media = mediaControls();

    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    });

    expect(requests).toEqual(["START"]);
    expect(media.hold).toHaveBeenNthCalledWith(1, "media-leg-1", true);
    expect(media.hold).toHaveBeenNthCalledWith(2, "media-leg-1", false);
    expect(screen.getByRole("button", { name: "Hold" })).toBeTruthy();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  });

  it("rejects a ringing offer directly through the persistent softphone", async () => {
    const offered = connectedCall("INBOUND");
    offered.answeredAt = null;
    offered.status = "RINGING";
    offered.winningLegId = null;
    offered.legs[0]!.status = "RINGING";
    const media = mediaControls("RINGING");
    const fetchEnd = mock(async () => new Response("{}", { status: 202 }));
    globalThis.fetch = fetchEnd as never;

    render(
      <CanonicalActiveCall
        call={offered}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });

    expect(fetchEnd).not.toHaveBeenCalled();
    expect(media.hangup).toHaveBeenCalledWith("media-leg-1");
  });

  it("shows the outbound patient number and connected controls", () => {
    render(
      <CanonicalActiveCall
        call={connectedCall("OUTBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={mediaControls()}
        sessionId="session-1"
      />,
    );

    expect(screen.getByText("(954) 287-2010")).toBeTruthy();
    expect(screen.getByText("Outbound")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
  });

  it("rings one available staff member while keeping the caller connected", async () => {
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        url,
      });
      return url.includes("clientInstanceId=")
        ? Response.json({
            targets: [{ endpointId: "endpoint-2", label: "Front desk" }],
          })
        : Response.json({ targetLegId: "agent-leg-2" }, { status: 202 });
    }) as never;

    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={mediaControls()}
        sessionId="session-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await screen.findByRole("option", { name: "Front desk" });
    expect(screen.getByText("You stay connected until they answer.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Transfer call" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual(
      expect.objectContaining({
        body: {
          clientInstanceId: "browser-1",
          expectedStateVersion: 2,
          targetEndpointId: "endpoint-2",
        },
        method: "POST",
      }),
    );
    expect(screen.getByRole("button", { name: "Ringing staff…" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "End" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("resumes a held outbound source before starting its transfer", async () => {
    const timeline: string[] = [];
    const media = mediaControls("HELD");
    media.hold.mockImplementation(async (_mediaLegId, held) => {
      timeline.push(held ? "hold" : "unhold");
      return true;
    });
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("clientInstanceId=")) {
        timeline.push("load targets");
        return Response.json({
          targets: [{ endpointId: "endpoint-2", label: "Front desk" }],
        });
      }
      if (url.endsWith("/hold-music")) {
        timeline.push(JSON.parse(String(init?.body)).action);
        return Response.json({ status: "DISPATCHED" }, { status: 202 });
      }
      timeline.push("start transfer");
      return Response.json({ targetLegId: "agent-leg-2" }, { status: 202 });
    }) as never;

    render(
      <CanonicalActiveCall
        call={connectedCall("OUTBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await screen.findByRole("option", { name: "Front desk" });
    fireEvent.click(screen.getByRole("button", { name: "Transfer call" }));

    await waitFor(() =>
      expect(timeline).toEqual(["load targets", "STOP", "unhold", "start transfer"]),
    );
    expect(media.hold).toHaveBeenCalledWith("media-leg-1", false);
  });

  it("holds and resumes the winning leg after an outbound transfer", async () => {
    const call = connectedCall("OUTBOUND");
    call.legs[0] = {
      ...call.legs[0]!,
      agentSessionId: "session-2",
      endpointId: "endpoint-2",
    };
    const media = mediaControls();
    const actions: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      actions.push(JSON.parse(String(init?.body)).action);
      return Response.json({ status: "CONFIRMED" }, { status: 202 });
    }) as unknown as typeof fetch;

    render(
      <CanonicalActiveCall
        call={call}
        clientInstanceId="browser-2"
        endpointId="endpoint-2"
        media={media}
        sessionId="session-2"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });

    expect(actions).toEqual(["START", "STOP"]);
    expect(media.hold).toHaveBeenNthCalledWith(1, "media-leg-1", true);
    expect(media.hold).toHaveBeenNthCalledWith(2, "media-leg-1", false);
  });

  it("uses a new operation key after a definitive transfer-start failure", async () => {
    const operationKeys: string[] = [];
    let postCount = 0;
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("clientInstanceId=")) {
        return Response.json({
          targets: [{ endpointId: "endpoint-2", label: "Front desk" }],
        });
      }
      postCount += 1;
      operationKeys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return postCount === 1
        ? Response.json(
            {
              error: {
                code: "PROVIDER_UNAVAILABLE",
                referenceId: "ABC123",
                retryable: true,
              },
            },
            { status: 503 },
          )
        : Response.json({ targetLegId: "agent-leg-2" }, { status: 202 });
    }) as never;

    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={mediaControls()}
        sessionId="session-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await screen.findByRole("option", { name: "Front desk" });
    fireEvent.click(screen.getByRole("button", { name: "Transfer call" }));
    await screen.findByRole("button", { name: "Transfer call" });
    fireEvent.click(screen.getByRole("button", { name: "Transfer call" }));
    await waitFor(() => expect(operationKeys).toHaveLength(2));
    expect(operationKeys[0]).not.toBe(operationKeys[1]);
  });

  it("reuses the operation key when the transfer response is lost", async () => {
    const operationKeys: string[] = [];
    let postCount = 0;
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("clientInstanceId=")) {
        return Response.json({
          targets: [{ endpointId: "endpoint-2", label: "Front desk" }],
        });
      }
      postCount += 1;
      operationKeys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      if (postCount === 1) throw new TypeError("response lost");
      return Response.json({ targetLegId: "agent-leg-2" }, { status: 202 });
    }) as never;

    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        clientInstanceId="browser-1"
        endpointId="endpoint-1"
        media={mediaControls()}
        sessionId="session-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await screen.findByRole("option", { name: "Front desk" });
    fireEvent.click(screen.getByRole("button", { name: "Transfer call" }));
    await screen.findByRole("button", { name: "Transfer call" });
    fireEvent.click(screen.getByRole("button", { name: "Transfer call" }));
    await waitFor(() => expect(operationKeys).toHaveLength(2));
    expect(operationKeys[0]).toBe(operationKeys[1]);
  });
});
