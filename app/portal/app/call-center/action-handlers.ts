import {
  CALL_DISPOSITIONS,
  type operatorFollowUp,
} from "@/lib/call-center/operator-follow-up";
import { normalizePhone } from "@/lib/phone";

const CALL_CENTER_MUTATION_ERROR = "Call center action could not be completed";
const CALL_OUTCOME_SAVE_ERROR =
  "We couldn't save this outcome. Check the details and try again.";

type PortalActionContext = {
  allowedLocationIds: string[];
  hasAllLocationAccess: boolean;
  practice: {
    id: string;
  };
  session: { user: { id: string } };
};

type FollowUpOperations = Pick<
  typeof operatorFollowUp,
  "resolveCallerThread" | "saveNote"
>;

type Dependencies = {
  followUp: FollowUpOperations;
  getContext: () => Promise<PortalActionContext | null>;
  reportError?: (error: unknown) => void;
  revalidate: (path: string) => void;
};

function actorFrom(context: PortalActionContext) {
  return {
    allowedLocationIds: context.allowedLocationIds,
    hasAllLocationAccess: context.hasAllLocationAccess,
    practiceId: context.practice.id,
    userId: context.session.user.id,
  };
}

function field(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function optionalField(formData: FormData, name: string) {
  return field(formData, name) || undefined;
}

function taskIds(formData: FormData) {
  return formData
    .getAll("taskId")
    .map(String)
    .map((taskId) => taskId.trim())
    .filter(Boolean);
}

function dispositionFrom(formData: FormData) {
  const disposition = field(formData, "disposition");
  const valid = CALL_DISPOSITIONS.find((value) => value === disposition);
  if (!valid) throw new Error(CALL_CENTER_MUTATION_ERROR);
  return valid;
}

function expectedStateVersion(formData: FormData) {
  const version = Number.parseInt(field(formData, "expectedStateVersion"), 10);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(CALL_CENTER_MUTATION_ERROR);
  }
  return version;
}

function revalidateCallCenterPaths(revalidate: (path: string) => void, phone: string) {
  revalidate("/portal/app/call-center");
  revalidate("/portal/app/call-center/follow-up");
  for (const value of new Set([phone, normalizePhone(phone)].filter(Boolean))) {
    revalidate(`/portal/app/call-center/callers/${encodeURIComponent(value as string)}`);
  }
}

export function createCallCenterActionHandlers({
  followUp,
  getContext,
  reportError = () => {},
  revalidate,
}: Dependencies) {
  async function resolveNeedsActionGroup(formData: FormData) {
    const context = await getContext();
    if (!context) throw new Error(CALL_CENTER_MUTATION_ERROR);
    const phone = field(formData, "phone");
    await followUp.resolveCallerThread(actorFrom(context), {
      expectedTaskIds: taskIds(formData),
      idempotencyKey: field(formData, "idempotencyKey"),
      locationId: optionalField(formData, "office"),
      phone,
      queueId: optionalField(formData, "queue"),
    });
    revalidateCallCenterPaths(revalidate, phone);
  }

  async function saveCallCenterNote(formData: FormData) {
    const context = await getContext();
    if (!context) {
      return { error: CALL_OUTCOME_SAVE_ERROR, ok: false as const };
    }
    const phone = field(formData, "phone");
    try {
      await followUp.saveNote(actorFrom(context), {
        callId: field(formData, "callId"),
        disposition: dispositionFrom(formData),
        expectedStateVersion: expectedStateVersion(formData),
        expectedTaskIds: taskIds(formData),
        idempotencyKey: field(formData, "idempotencyKey"),
        locationId: optionalField(formData, "office"),
        note: optionalField(formData, "note") ?? null,
        phone,
        queueId: optionalField(formData, "queue"),
      });
      revalidateCallCenterPaths(revalidate, phone);
      return { ok: true as const };
    } catch (error) {
      reportError(error);
      return { error: CALL_OUTCOME_SAVE_ERROR, ok: false as const };
    }
  }

  return { resolveNeedsActionGroup, saveCallCenterNote };
}
