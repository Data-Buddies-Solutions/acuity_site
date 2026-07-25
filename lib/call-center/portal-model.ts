import { normalizePhone } from "@/lib/phone";
import { getPracticeBranding } from "@/lib/practice-branding";

type PortalCallDisposition =
  "CALLBACK_NEEDED" | "FOLLOW_UP_REQUIRED" | "OTHER" | "RESOLVED" | "WRONG_NUMBER";
type PortalCallDirection = "INBOUND" | "INTERNAL" | "OUTBOUND" | "UNKNOWN";
type PortalCallStatus =
  "ACTIVE" | "COMPLETED" | "FAILED" | "MISSED" | "RINGING" | "VOICEMAIL";

type PortalCallActivityKind = "missed" | "note" | "voicemail";

export type PortalCallActivityItem = {
  callerName: string | null;
  createdAt: Date;
  disposition: PortalCallDisposition | null;
  durationSec: number | null;
  fromPhone: string | null;
  kind: PortalCallActivityKind;
  locationId: string | null;
  locationName: string | null;
  queueId: string | null;
  recordingId: string | null;
  taskId: string;
};

export type PortalNeedsActionGroup = {
  callbackNeededCount: number;
  callerName: string | null;
  eventCount: number;
  followUpRequiredCount: number;
  fromPhone: string | null;
  id: string;
  lastActivityAt: Date;
  latestKind: PortalCallActivityKind;
  latestVoicemailDurationSec: number | null;
  latestVoicemailRecordingId: string | null;
  locationId: string | null;
  locationNames: string[];
  missedCount: number;
  noteCount: number;
  queueId: string | null;
  taskIds: string[];
  voicemailCount: number;
};

export type PortalNeedsActionPreviewItem = PortalNeedsActionGroup & {
  activities: PortalCallActivityItem[];
};

export type PortalCallCenterLocation = {
  id: string;
  label: string;
  locationId?: string | null;
  locationIds?: string[];
};

export type PortalRecentCallItem = {
  answeredBy: string | null;
  connected: boolean;
  direction: PortalCallDirection;
  durationSec: number | null;
  fromPhone: string | null;
  id: string;
  locationName: string | null;
  occurredAt: Date;
  providerCallSessionId?: string | null;
  startedAt: Date;
  status: PortalCallStatus;
  toPhone: string | null;
};

export type PortalCallCenterHistoryTotals = {
  inboundCalls: number;
  outboundDialedCalls: number;
  outboundCalls: number;
  totalCalls: number;
};

export type PortalCallCenterHistoryRange = "24h" | "7d" | "all";
export type PortalCallCenterHistoryView = "all" | "connections";

export type PortalCallerTimelineItem = {
  body: string | null;
  connectedLaterAt?: Date | null;
  direction: "inbound" | "outbound" | null;
  durationSec: number | null;
  id: string;
  kind: "call" | "missed" | "note" | "text" | "voicemail";
  locationName: string | null;
  note: string | null;
  occurredAt: Date;
  phone: string | null;
  providerCallSessionId?: string | null;
  recordId: string | null;
  recordingId: string | null;
  agentLabel: string | null;
  status: string | null;
  title: string;
};

export type PortalCallerTimeline = {
  branding: ReturnType<typeof getPracticeBranding>;
  callerName: string | null;
  items: PortalCallerTimelineItem[];
  latestCall: { id: string; stateVersion: number } | null;
  latestItem: PortalCallerTimelineItem | null;
  latestNeedsActionItem: PortalCallerTimelineItem | null;
  openCycleToken: string;
  openTaskCount: number;
  page: number;
  pageSize: number;
  phone: string;
  practiceName: string;
  range: PortalCallCenterHistoryRange;
  totalPages: number;
  totals: {
    inboundItems: number;
    outboundConnectedCalls: number;
    outboundDialedCalls: number;
    totalItems: number;
  };
};

function phoneKey(phone: string | null | undefined) {
  return normalizePhone(phone) || phone?.trim() || "Unknown";
}

export function portalNeedsActionGroupId(
  phone: string | null | undefined,
  queueId?: string | null,
  locationId?: string | null,
) {
  return `needs-action:${queueId ?? "no-queue"}:${locationId ?? "no-location"}:${phoneKey(phone)}`;
}

export function buildPortalNeedsActionGroups(events: PortalCallActivityItem[]) {
  type NeedsActionAccumulator = PortalNeedsActionGroup & {
    latestVoicemailAt: Date | null;
  };
  const groups = new Map<string, NeedsActionAccumulator>();
  for (const event of events) {
    const key = `${event.queueId ?? "no-queue"}:${event.locationId ?? "no-location"}:${phoneKey(event.fromPhone)}`;
    const current =
      groups.get(key) ??
      ({
        callbackNeededCount: 0,
        callerName: event.callerName,
        eventCount: 0,
        followUpRequiredCount: 0,
        fromPhone: event.fromPhone,
        id: portalNeedsActionGroupId(event.fromPhone, event.queueId, event.locationId),
        lastActivityAt: event.createdAt,
        latestKind: event.kind,
        latestVoicemailAt: null,
        latestVoicemailDurationSec: null,
        latestVoicemailRecordingId: null,
        locationId: event.locationId,
        locationNames: [],
        missedCount: 0,
        noteCount: 0,
        queueId: event.queueId,
        taskIds: [],
        voicemailCount: 0,
      } satisfies NeedsActionAccumulator);
    current.eventCount += 1;
    current.missedCount += event.kind === "missed" ? 1 : 0;
    current.noteCount += event.kind === "note" ? 1 : 0;
    current.taskIds.push(event.taskId);
    current.voicemailCount += event.kind === "voicemail" ? 1 : 0;
    current.callbackNeededCount += event.disposition === "CALLBACK_NEEDED" ? 1 : 0;
    current.followUpRequiredCount += event.disposition === "FOLLOW_UP_REQUIRED" ? 1 : 0;
    if (event.locationName && !current.locationNames.includes(event.locationName)) {
      current.locationNames.push(event.locationName);
    }
    if (!current.callerName && event.callerName) current.callerName = event.callerName;
    if (!current.fromPhone && event.fromPhone) current.fromPhone = event.fromPhone;
    if (
      event.kind === "voicemail" &&
      (!current.latestVoicemailAt || event.createdAt > current.latestVoicemailAt)
    ) {
      current.latestVoicemailAt = event.createdAt;
      current.latestVoicemailDurationSec = event.durationSec;
      current.latestVoicemailRecordingId = event.recordingId;
    }
    if (event.createdAt > current.lastActivityAt) {
      current.lastActivityAt = event.createdAt;
      current.latestKind = event.kind;
    }
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime())
    .map(({ latestVoicemailAt: _latestVoicemailAt, ...group }) => group);
}
