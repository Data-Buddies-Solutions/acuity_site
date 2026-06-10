import {
  SmsConversationStatus,
  SmsMessageDirection,
  SmsMessageStatus,
  type Prisma,
} from "@/generated/prisma/client";

import {
  canAccessPortalLocation,
  getCurrentPortalPracticeContext,
  type PortalPracticeAccessContext,
} from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { TelnyxError, telnyxErrorMessage, telnyxFetch } from "@/lib/telnyx";

import { formatSmsPhone, normalizeSmsPhone, smsPhoneLookupVariants } from "./phone";

export const SPRING_HILL_SMS_NUMBER = "+17275919997";
const ABITA_PRACTICE_NAME = "Abita Eye Group";
const SPRING_HILL_LABEL = "Spring Hill";
const SOUTH_FLORIDA_LABEL = "Hollywood / Sweetwater";
const SPRING_HILL_SMS_EMAILS = new Set([
  "debbie@abitaeye.com",
  "emilyisha@abitaeye.com",
  "springhill@abitaeye.com",
]);
const SOUTH_FLORIDA_SMS_EMAILS = new Set([
  "aileen@abitaeye.com",
  "justin@abitaeye.com",
  "hollywoodsweetwater@abitaeye.com",
  "callcenter@abitaeye.com",
]);
const SOUTH_FLORIDA_LOCATION_NAMES = new Set(["hollywood", "sweetwater"]);
const TEXT_PREVIEW_LENGTH = 96;
const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);
const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);

type RecordLike = Record<string, unknown>;

export type SmsConversationListItem = {
  id: string;
  lastInboundAt: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageStatus: SmsMessageStatus;
  lastMessageDirection: SmsMessageDirection;
  locationName: string | null;
  optedOut: boolean;
  patientPhoneNumber: string;
  patientPhoneNumberDisplay: string;
  status: SmsConversationStatus;
  unread: boolean;
};

export type SmsMessageItem = {
  body: string;
  createdAt: string;
  direction: SmsMessageDirection;
  errorDetail: string | null;
  id: string;
  status: SmsMessageStatus;
  sentByName: string | null;
};

export type SmsConversationDetail = SmsConversationListItem & {
  messages: SmsMessageItem[];
  practiceNumber: string;
  readBy: Array<{
    lastReadAt: string;
    name: string;
  }>;
};

export type SmsInboxOption = {
  id: string;
  label: string;
  locationName: string | null;
  phoneNumber: string;
};

type PracticeSmsPhoneNumber = Prisma.PracticePhoneNumberGetPayload<{
  include: {
    location: true;
    practice: true;
  };
}>;

type SmsContext = NonNullable<Awaited<ReturnType<typeof resolveSmsContext>>>;

function isRecord(value: unknown): value is RecordLike {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value: unknown) {
  const raw = asString(value);
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function textPreview(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > TEXT_PREVIEW_LENGTH
    ? `${cleaned.slice(0, TEXT_PREVIEW_LENGTH - 1)}...`
    : cleaned;
}

function firstRecipientPhone(payload: RecordLike) {
  const recipients = Array.isArray(payload.to) ? payload.to : [];
  for (const recipient of recipients) {
    if (isRecord(recipient)) {
      const phone = normalizeSmsPhone(asString(recipient.phone_number));
      if (phone) {
        return phone;
      }
    }
  }

  return "";
}

function senderPhone(payload: RecordLike) {
  return isRecord(payload.from)
    ? normalizeSmsPhone(asString(payload.from.phone_number))
    : normalizeSmsPhone(asString(payload.from));
}

function recipientStatus(payload: RecordLike) {
  const recipients = Array.isArray(payload.to) ? payload.to : [];
  const first = recipients.find(isRecord);
  return first ? asString(first.status) : "";
}

function payloadError(payload: RecordLike) {
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const first = errors.find(isRecord);

  if (!first) {
    return { code: null, detail: null };
  }

  return {
    code: asString(first.code) || asString(first.title) || null,
    detail: asString(first.detail) || asString(first.title) || null,
  };
}

function smsContentKeyword(text: string) {
  return text.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeSmsBody(body: string) {
  const trimmed = body.replace(/\s+/g, " ").trim();

  if (!trimmed) {
    throw new TelnyxError("Message body is required", 400);
  }

  if (trimmed.length > 1_000) {
    throw new TelnyxError("Message body must be 1,000 characters or fewer", 422);
  }

  return trimmed;
}

function isAbitaPractice(practice: { name: string }) {
  return practice.name.trim().toLowerCase() === ABITA_PRACTICE_NAME.toLowerCase();
}

async function findPracticeNumberByPhone(phone: string, practiceId?: string) {
  const variants = smsPhoneLookupVariants(phone);
  return prisma.practicePhoneNumber.findFirst({
    include: {
      location: true,
      practice: true,
    },
    where: {
      phoneNumber: {
        in: variants,
      },
      ...(practiceId ? { practiceId } : {}),
    },
  });
}

function isSpringHillSmsNumber(phoneNumber: PracticeSmsPhoneNumber) {
  return normalizeSmsPhone(phoneNumber.phoneNumber) === SPRING_HILL_SMS_NUMBER;
}

function isSouthFloridaPrimarySmsNumber(phoneNumber: PracticeSmsPhoneNumber) {
  return Boolean(
    phoneNumber.isPrimary &&
    phoneNumber.location?.name &&
    SOUTH_FLORIDA_LOCATION_NAMES.has(phoneNumber.location.name.trim().toLowerCase()),
  );
}

function isInboundEligiblePracticeNumber(phoneNumber: PracticeSmsPhoneNumber) {
  if (!isAbitaPractice(phoneNumber.practice)) {
    return true;
  }

  return (
    isSpringHillSmsNumber(phoneNumber) || isSouthFloridaPrimarySmsNumber(phoneNumber)
  );
}

async function findPracticeNumberByInboundTo(toNumber: string) {
  const practiceNumber = await findPracticeNumberByPhone(toNumber);
  return practiceNumber && isInboundEligiblePracticeNumber(practiceNumber)
    ? practiceNumber
    : null;
}

function smsInboxLabel(phoneNumber: PracticeSmsPhoneNumber) {
  if (isSpringHillSmsNumber(phoneNumber)) {
    return SPRING_HILL_LABEL;
  }

  return phoneNumber.location?.name || phoneNumber.label || phoneNumber.phoneNumber;
}

function sortSmsInboxOptions(a: PracticeSmsPhoneNumber, b: PracticeSmsPhoneNumber) {
  const order = new Map([
    ["spring hill", 0],
    ["hollywood", 1],
    ["sweetwater", 2],
  ]);
  const aName = a.location?.name.trim().toLowerCase() ?? "";
  const bName = b.location?.name.trim().toLowerCase() ?? "";
  return (order.get(aName) ?? 99) - (order.get(bName) ?? 99);
}

async function getAllowedSmsPhoneNumbers(context: PortalPracticeAccessContext) {
  const email = context.session.user.email?.trim().toLowerCase() ?? "";
  const allPracticeNumbers = await prisma.practicePhoneNumber.findMany({
    include: {
      location: true,
      practice: true,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    where: {
      practiceId: context.practice.id,
    },
  });

  if (isAbitaPractice(context.practice)) {
    if (SPRING_HILL_SMS_EMAILS.has(email)) {
      return allPracticeNumbers.filter(isSpringHillSmsNumber).sort(sortSmsInboxOptions);
    }

    if (SOUTH_FLORIDA_SMS_EMAILS.has(email)) {
      return allPracticeNumbers
        .filter(isSouthFloridaPrimarySmsNumber)
        .sort(sortSmsInboxOptions);
    }

    return [];
  }

  return allPracticeNumbers
    .filter((phoneNumber) => canAccessPortalLocation(context, phoneNumber.locationId))
    .sort(sortSmsInboxOptions);
}

function serializeSmsInboxOption(phoneNumber: PracticeSmsPhoneNumber): SmsInboxOption {
  return {
    id: phoneNumber.id,
    label: smsInboxLabel(phoneNumber),
    locationName: phoneNumber.location?.name ?? null,
    phoneNumber: phoneNumber.phoneNumber,
  };
}

async function resolveSmsContext(practiceNumberId?: string | null) {
  const context = await getCurrentPortalPracticeContext();

  if (!context) {
    return null;
  }

  const availablePhoneNumbers = await getAllowedSmsPhoneNumbers(context);
  const requested = practiceNumberId
    ? availablePhoneNumbers.find((phoneNumber) => phoneNumber.id === practiceNumberId)
    : null;
  const phoneNumber = requested ?? availablePhoneNumbers[0] ?? null;

  return {
    availableInboxes: availablePhoneNumbers.map(serializeSmsInboxOption),
    context,
    phoneNumber,
  };
}

async function applyOptKeyword({
  conversationId,
  keyword,
  patientPhoneNumber,
  practiceNumberId,
}: {
  conversationId: string;
  keyword: string;
  patientPhoneNumber: string;
  practiceNumberId: string;
}) {
  if (STOP_KEYWORDS.has(keyword)) {
    await prisma.$transaction([
      prisma.smsOptOut.upsert({
        create: {
          patientPhoneNumber,
          practiceNumberId,
          source: "STOP_KEYWORD",
        },
        update: {
          optedOutAt: new Date(),
          source: "STOP_KEYWORD",
        },
        where: {
          practiceNumberId_patientPhoneNumber: {
            patientPhoneNumber,
            practiceNumberId,
          },
        },
      }),
      prisma.smsConversation.update({
        data: {
          optedOut: true,
          optedOutAt: new Date(),
        },
        where: {
          id: conversationId,
        },
      }),
    ]);
  }

  if (START_KEYWORDS.has(keyword)) {
    await prisma.$transaction([
      prisma.smsOptOut.deleteMany({
        where: {
          patientPhoneNumber,
          practiceNumberId,
        },
      }),
      prisma.smsConversation.update({
        data: {
          optedOut: false,
          optedOutAt: null,
        },
        where: {
          id: conversationId,
        },
      }),
    ]);
  }
}

export function isTelnyxSmsEvent(body: unknown) {
  if (!isRecord(body) || !isRecord(body.data)) {
    return false;
  }

  return ["message.received", "message.sent", "message.finalized"].includes(
    asString(body.data.event_type),
  );
}

export async function handleTelnyxSmsWebhookEvent(body: unknown) {
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.payload)) {
    return { ignored: true };
  }

  const eventType = asString(body.data.event_type);
  const payload = body.data.payload;

  switch (eventType) {
    case "message.received":
      return handleInboundMessage(body.data, payload);
    case "message.sent":
    case "message.finalized":
      return handleDeliveryUpdate(eventType, payload);
    default:
      return { ignored: true };
  }
}

async function handleInboundMessage(data: RecordLike, payload: RecordLike) {
  const fromNumber = senderPhone(payload);
  const toNumber = firstRecipientPhone(payload);
  const body = asString(payload.text);
  const telnyxMessageId = asString(payload.id);
  const receivedAt =
    asDate(payload.received_at) ?? asDate(data.occurred_at) ?? new Date();

  if (!fromNumber || !toNumber || !body || !telnyxMessageId) {
    return { ignored: true, reason: "missing_message_fields" };
  }

  const practiceNumber = await findPracticeNumberByInboundTo(toNumber);

  if (!practiceNumber) {
    return { ignored: true, reason: "unknown_practice_number" };
  }

  const existingOptOut = await prisma.smsOptOut.findUnique({
    where: {
      practiceNumberId_patientPhoneNumber: {
        patientPhoneNumber: fromNumber,
        practiceNumberId: practiceNumber.id,
      },
    },
  });

  const conversation = await prisma.smsConversation.upsert({
    create: {
      lastInboundAt: receivedAt,
      lastMessageAt: receivedAt,
      locationId: practiceNumber.locationId,
      optedOut: Boolean(existingOptOut),
      optedOutAt: existingOptOut?.optedOutAt ?? null,
      patientPhoneNumber: fromNumber,
      practiceId: practiceNumber.practiceId,
      practiceNumberId: practiceNumber.id,
      status: SmsConversationStatus.OPEN,
    },
    update: {
      lastInboundAt: receivedAt,
      lastMessageAt: receivedAt,
      status: SmsConversationStatus.OPEN,
    },
    where: {
      practiceNumberId_patientPhoneNumber: {
        patientPhoneNumber: fromNumber,
        practiceNumberId: practiceNumber.id,
      },
    },
  });

  await prisma.smsMessage.upsert({
    create: {
      body,
      conversationId: conversation.id,
      createdAt: receivedAt,
      direction: SmsMessageDirection.INBOUND,
      fromNumber,
      status: SmsMessageStatus.RECEIVED,
      telnyxMessageId,
      toNumber,
    },
    update: {},
    where: {
      telnyxMessageId,
    },
  });

  await applyOptKeyword({
    conversationId: conversation.id,
    keyword: smsContentKeyword(body),
    patientPhoneNumber: fromNumber,
    practiceNumberId: practiceNumber.id,
  });

  return {
    conversationId: conversation.id,
    eventType: "message.received",
    ignored: false,
    practiceId: practiceNumber.practiceId,
  };
}

async function handleDeliveryUpdate(eventType: string, payload: RecordLike) {
  const telnyxMessageId = asString(payload.id);

  if (!telnyxMessageId) {
    return { ignored: true, reason: "missing_message_id" };
  }

  const { code, detail } = payloadError(payload);
  const recipientDeliveryStatus = recipientStatus(payload).toLowerCase();
  const failed = Boolean(code || detail || recipientDeliveryStatus.includes("fail"));
  const delivered =
    !failed &&
    (recipientDeliveryStatus.includes("deliver") ||
      Boolean(asString(payload.completed_at)));
  const status =
    eventType === "message.sent"
      ? SmsMessageStatus.SENT
      : failed
        ? SmsMessageStatus.FAILED
        : delivered
          ? SmsMessageStatus.DELIVERED
          : SmsMessageStatus.SENT;
  const completedAt = asDate(payload.completed_at) ?? new Date();

  const message = await prisma.smsMessage.updateMany({
    data: {
      errorCode: code,
      errorDetail: detail,
      failedAt: status === SmsMessageStatus.FAILED ? completedAt : undefined,
      status,
      deliveredAt: status === SmsMessageStatus.DELIVERED ? completedAt : undefined,
    },
    where: {
      telnyxMessageId,
    },
  });

  return {
    eventType,
    ignored: message.count === 0,
    messageId: telnyxMessageId,
    reason: message.count === 0 ? "unknown_message" : undefined,
  };
}

function conversationWhereForCurrentUser({
  allowedPracticeNumberIds,
  conversationId,
  context,
  practiceNumberId,
  search,
}: {
  allowedPracticeNumberIds?: string[];
  conversationId?: string;
  context: PortalPracticeAccessContext;
  practiceNumberId?: string;
  search?: string | null;
}): Prisma.SmsConversationWhereInput {
  const digits = (search || "").replace(/\D/g, "");

  return {
    ...(conversationId ? { id: conversationId } : {}),
    practiceId: context.practice.id,
    ...(practiceNumberId
      ? { practiceNumberId }
      : allowedPracticeNumberIds
        ? {
            practiceNumberId: {
              in: allowedPracticeNumberIds,
            },
          }
        : {}),
    ...(digits
      ? {
          patientPhoneNumber: {
            contains: digits,
          },
        }
      : {}),
  };
}

function allowedPracticeNumberIds(resolved: SmsContext) {
  return resolved.availableInboxes.map((inbox) => inbox.id);
}

function serializeConversation(
  conversation: Prisma.SmsConversationGetPayload<{
    include: {
      location: true;
      messages: { orderBy: { createdAt: "desc" }; take: 1 };
      reads: true;
    };
  }>,
  userId: string,
): SmsConversationListItem {
  const lastMessage = conversation.messages[0];
  const read = conversation.reads.find((item) => item.userId === userId);
  const unread = Boolean(
    conversation.lastInboundAt &&
    (!read || read.lastReadAt.getTime() < conversation.lastInboundAt.getTime()),
  );

  return {
    id: conversation.id,
    lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    lastMessageDirection: lastMessage?.direction ?? SmsMessageDirection.INBOUND,
    lastMessagePreview: textPreview(lastMessage?.body ?? ""),
    lastMessageStatus: lastMessage?.status ?? SmsMessageStatus.RECEIVED,
    locationName: conversation.location?.name ?? null,
    optedOut: conversation.optedOut,
    patientPhoneNumber: conversation.patientPhoneNumber,
    patientPhoneNumberDisplay: formatSmsPhone(conversation.patientPhoneNumber),
    status: conversation.status,
    unread,
  };
}

export async function getSmsInbox(
  practiceNumberId?: string | null,
  search?: string | null,
) {
  const resolved = await resolveSmsContext(practiceNumberId);

  if (!resolved?.context) {
    return null;
  }

  if (!resolved.phoneNumber) {
    return {
      configured: false,
      conversations: [],
      currentUserId: resolved.context.session.user.id,
      availableInboxes: resolved.availableInboxes,
      locationName: isAbitaPractice(resolved.context.practice)
        ? SOUTH_FLORIDA_LABEL
        : "Texting",
      practiceName: resolved.context.practice.name,
      practiceNumber: "",
      selectedInboxId: "",
      unreadCount: 0,
    };
  }

  const conversations = await prisma.smsConversation.findMany({
    include: {
      location: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      reads: {
        where: {
          userId: resolved.context.session.user.id,
        },
      },
    },
    orderBy: [{ lastMessageAt: "desc" }],
    take: 50,
    where: conversationWhereForCurrentUser({
      context: resolved.context,
      practiceNumberId: resolved.phoneNumber.id,
      search,
    }),
  });
  const items = conversations.map((conversation) =>
    serializeConversation(conversation, resolved.context.session.user.id),
  );

  return {
    availableInboxes: resolved.availableInboxes,
    configured: true,
    conversations: items,
    currentUserId: resolved.context.session.user.id,
    locationName: smsInboxLabel(resolved.phoneNumber),
    practiceName: resolved.context.practice.name,
    practiceNumber: resolved.phoneNumber.phoneNumber,
    selectedInboxId: resolved.phoneNumber.id,
    unreadCount: items.filter((item) => item.unread).length,
  };
}

export async function getSmsConversation(conversationId: string) {
  const resolved = await resolveSmsContext();

  if (!resolved?.context) {
    return null;
  }

  const allowedIds = allowedPracticeNumberIds(resolved);
  if (!allowedIds.length) {
    return { notFound: true as const };
  }

  const conversation = await prisma.smsConversation.findFirst({
    include: {
      location: true,
      messages: {
        include: {
          sentByUser: true,
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      },
      reads: {
        include: {
          user: true,
        },
        orderBy: { lastReadAt: "desc" },
        take: 6,
      },
    },
    where: conversationWhereForCurrentUser({
      allowedPracticeNumberIds: allowedIds,
      conversationId,
      context: resolved.context,
    }),
  });

  if (!conversation) {
    return { notFound: true as const };
  }

  try {
    await prisma.smsConversationRead.upsert({
      create: {
        conversationId: conversation.id,
        lastReadAt: new Date(),
        userId: resolved.context.session.user.id,
      },
      update: {
        lastReadAt: new Date(),
      },
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: resolved.context.session.user.id,
        },
      },
    });
  } catch (readError) {
    if (isRecord(readError) && readError.code === "P2003") {
      return { notFound: true as const };
    }

    throw readError;
  }

  const base = serializeConversation(
    {
      ...conversation,
      messages: conversation.messages.slice(-1),
      reads: conversation.reads.filter(
        (read) => read.userId === resolved.context.session.user.id,
      ),
    },
    resolved.context.session.user.id,
  );

  return {
    ...base,
    messages: conversation.messages.map((message) => ({
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      direction: message.direction,
      errorDetail: message.errorDetail,
      id: message.id,
      sentByName: message.sentByUser?.name ?? null,
      status: message.status,
    })),
    practiceNumber:
      resolved.availableInboxes.find(
        (inbox) => inbox.id === conversation.practiceNumberId,
      )?.phoneNumber ??
      resolved.phoneNumber?.phoneNumber ??
      "",
    readBy: conversation.reads.map((read) => ({
      lastReadAt: read.lastReadAt.toISOString(),
      name: read.user.name,
    })),
  } satisfies SmsConversationDetail;
}

export async function updateSmsConversationStatus(
  conversationId: string,
  status: SmsConversationStatus,
) {
  const resolved = await resolveSmsContext();

  if (!resolved?.context) {
    return null;
  }

  const allowedIds = allowedPracticeNumberIds(resolved);
  if (!allowedIds.length) {
    return { notFound: true as const };
  }

  const updated = await prisma.smsConversation.updateMany({
    data: { status },
    where: conversationWhereForCurrentUser({
      allowedPracticeNumberIds: allowedIds,
      conversationId,
      context: resolved.context,
    }),
  });

  return { notFound: updated.count === 0 };
}

export async function deleteSmsConversation(conversationId: string) {
  const resolved = await resolveSmsContext();

  if (!resolved?.context) {
    return null;
  }

  const allowedIds = allowedPracticeNumberIds(resolved);
  if (!allowedIds.length) {
    return { notFound: true as const };
  }

  const conversation = await prisma.smsConversation.findFirst({
    select: {
      id: true,
      status: true,
    },
    where: conversationWhereForCurrentUser({
      allowedPracticeNumberIds: allowedIds,
      conversationId,
      context: resolved.context,
    }),
  });

  if (!conversation) {
    return { notFound: true as const };
  }

  if (conversation.status !== SmsConversationStatus.CLOSED) {
    return { notClosed: true as const };
  }

  await prisma.smsConversation.delete({
    where: {
      id: conversation.id,
    },
  });

  return { ok: true as const };
}

async function deliverOutboundSms({
  body,
  from,
  messageId,
  to,
}: {
  body: string;
  from: string;
  messageId: string;
  to: string;
}) {
  const response = await telnyxFetch("/v2/messages", {
    body: JSON.stringify({
      from,
      text: body,
      to,
      use_profile_webhooks: true,
    }),
    method: "POST",
  });

  if (!response.ok) {
    const detail = await telnyxErrorMessage(response, "Failed to send SMS");
    await prisma.smsMessage.update({
      data: {
        errorDetail: detail,
        failedAt: new Date(),
        status: SmsMessageStatus.FAILED,
      },
      where: {
        id: messageId,
      },
    });
    throw new TelnyxError("Failed to send SMS", response.status, detail);
  }

  const result = (await response.json()) as unknown;
  const telnyxMessageId =
    isRecord(result) && isRecord(result.data) ? asString(result.data.id) : "";

  await prisma.smsMessage.update({
    data: {
      status: SmsMessageStatus.SENT,
      telnyxMessageId: telnyxMessageId || null,
    },
    where: {
      id: messageId,
    },
  });
}

export async function startOutboundSmsConversation({
  body,
  patientPhoneNumber,
  practiceNumberId,
}: {
  body: string;
  patientPhoneNumber: string;
  practiceNumberId: string;
}) {
  const resolved = await resolveSmsContext(practiceNumberId);

  if (!resolved?.context) {
    return null;
  }

  if (!resolved.phoneNumber || resolved.phoneNumber.id !== practiceNumberId) {
    return { notFound: true as const };
  }

  if (!resolved.phoneNumber.smsEnabled) {
    throw new TelnyxError("This inbox is not enabled for outbound SMS", 403);
  }

  const toNumber = normalizeSmsPhone(patientPhoneNumber);
  if (!toNumber) {
    throw new TelnyxError("Enter a valid patient mobile number", 422);
  }

  const trimmed = normalizeSmsBody(body);
  const existingOptOut = await prisma.smsOptOut.findUnique({
    where: {
      practiceNumberId_patientPhoneNumber: {
        patientPhoneNumber: toNumber,
        practiceNumberId: resolved.phoneNumber.id,
      },
    },
  });

  if (existingOptOut) {
    throw new TelnyxError("This patient has opted out of SMS replies", 403);
  }

  const now = new Date();
  const conversation = await prisma.smsConversation.upsert({
    create: {
      lastMessageAt: now,
      locationId: resolved.phoneNumber.locationId,
      patientPhoneNumber: toNumber,
      practiceId: resolved.context.practice.id,
      practiceNumberId: resolved.phoneNumber.id,
      status: SmsConversationStatus.OPEN,
    },
    update: {
      status: SmsConversationStatus.OPEN,
    },
    where: {
      practiceNumberId_patientPhoneNumber: {
        patientPhoneNumber: toNumber,
        practiceNumberId: resolved.phoneNumber.id,
      },
    },
  });

  if (conversation.optedOut) {
    throw new TelnyxError("This patient has opted out of SMS replies", 403);
  }

  const message = await prisma.smsMessage.create({
    data: {
      body: trimmed,
      conversationId: conversation.id,
      direction: SmsMessageDirection.OUTBOUND,
      fromNumber: resolved.phoneNumber.phoneNumber,
      sentByUserId: resolved.context.session.user.id,
      status: SmsMessageStatus.SENDING,
      toNumber,
    },
  });

  await prisma.smsConversation.update({
    data: {
      lastMessageAt: message.createdAt,
      status: SmsConversationStatus.OPEN,
    },
    where: {
      id: conversation.id,
    },
  });

  try {
    await deliverOutboundSms({
      body: trimmed,
      from: resolved.phoneNumber.phoneNumber,
      messageId: message.id,
      to: toNumber,
    });
  } catch (error) {
    if (error instanceof TelnyxError) {
      return {
        conversationId: conversation.id,
        detail: error.detail ?? null,
        error: error.message,
        messageId: message.id,
        ok: false,
      };
    }

    throw error;
  }

  return { conversationId: conversation.id, messageId: message.id, ok: true };
}

export async function sendSmsReply(conversationId: string, body: string) {
  const resolved = await resolveSmsContext();

  if (!resolved?.context) {
    return null;
  }

  const allowedIds = allowedPracticeNumberIds(resolved);
  if (!allowedIds.length) {
    return { notFound: true as const };
  }

  const trimmed = normalizeSmsBody(body);

  const conversation = await prisma.smsConversation.findFirst({
    where: conversationWhereForCurrentUser({
      allowedPracticeNumberIds: allowedIds,
      conversationId,
      context: resolved.context,
    }),
  });

  if (!conversation) {
    return { notFound: true as const };
  }

  const practiceNumber = resolved.availableInboxes.find(
    (inbox) => inbox.id === conversation.practiceNumberId,
  );

  if (!practiceNumber) {
    return { notFound: true as const };
  }

  if (conversation.optedOut) {
    throw new TelnyxError("This patient has opted out of SMS replies", 403);
  }

  const message = await prisma.smsMessage.create({
    data: {
      body: trimmed,
      conversationId: conversation.id,
      direction: SmsMessageDirection.OUTBOUND,
      fromNumber: practiceNumber.phoneNumber,
      sentByUserId: resolved.context.session.user.id,
      status: SmsMessageStatus.SENDING,
      toNumber: conversation.patientPhoneNumber,
    },
  });

  await prisma.smsConversation.update({
    data: {
      lastMessageAt: message.createdAt,
      status: SmsConversationStatus.OPEN,
    },
    where: {
      id: conversation.id,
    },
  });

  await deliverOutboundSms({
    body: trimmed,
    from: practiceNumber.phoneNumber,
    messageId: message.id,
    to: conversation.patientPhoneNumber,
  });

  return { messageId: message.id, ok: true };
}
