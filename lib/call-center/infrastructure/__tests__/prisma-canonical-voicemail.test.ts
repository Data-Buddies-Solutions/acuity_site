import { describe, expect, it } from "bun:test";

import type { Prisma } from "@/generated/prisma/client";

import {
  CanonicalVoicemailPersistenceError,
  persistCanonicalVoicemail,
} from "../prisma-canonical-voicemail";

const now = new Date("2026-07-12T12:00:00.000Z");

function fakeDatabase({ existing = false, mismatch = false } = {}) {
  const operations: string[] = [];
  let voicemailCreates = 0;
  let taskUpserts = 0;
  const stored = existing
    ? {
        callCenterCallId: "call-1",
        id: "voicemail-1",
        recordingId: mismatch ? "recording-other" : "recording-1",
      }
    : null;
  const transaction = {
    callCenterCall: {
      findUnique: async () => ({
        number: { practicePhoneNumber: { locationId: "location-1" } },
      }),
    },
    callCenterTask: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        operations.push("task.upsert");
        taskUpserts += 1;
        expect(create).toMatchObject({
          callId: "call-1",
          dedupeKey: "voicemail:call-1",
          kind: "VOICEMAIL",
          sourceEventRevision: BigInt(9),
        });
        return { id: "task-1" };
      },
    },
    callCenterVoicemail: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push("voicemail.create");
        voicemailCreates += 1;
        expect(data).toMatchObject({
          callCenterCallId: "call-1",
          durationSec: 12,
          locationId: "location-1",
          recordingId: "recording-1",
          recordingUrl: "https://example.test/voicemail.mp3",
        });
        return { id: "voicemail-1" };
      },
      findUnique: async ({ where }: { where: Record<string, string> }) => {
        if (where.callCenterCallId) return stored;
        return stored?.recordingId === where.recordingId ? stored : null;
      },
      update: async () => {
        operations.push("voicemail.update");
        return { id: "voicemail-1" };
      },
    },
  } as unknown as Prisma.TransactionClient;

  const persist = () =>
    persistCanonicalVoicemail(transaction, {
      call: {
        callerName: "Patient",
        fromPhone: "+17865550100",
        id: "call-1",
        practiceId: "practice-1",
      },
      occurredAt: now,
      recording: {
        durationSec: 12,
        id: "recording-1",
        url: "https://example.test/voicemail.mp3",
      },
      sourceEventRevision: BigInt(9),
    });
  return {
    get taskUpserts() {
      return taskUpserts;
    },
    get voicemailCreates() {
      return voicemailCreates;
    },
    operations,
    persist,
  };
}

describe("canonical voicemail persistence", () => {
  it("creates one call-linked voicemail before its deduplicated task", async () => {
    const fake = fakeDatabase();
    await expect(fake.persist()).resolves.toEqual({ id: "voicemail-1" });
    expect(fake.operations).toEqual(["voicemail.create", "task.upsert"]);
    expect(fake.voicemailCreates).toBe(1);
    expect(fake.taskUpserts).toBe(1);
  });

  it("updates an exact replay without creating another voicemail", async () => {
    const fake = fakeDatabase({ existing: true });
    await fake.persist();
    await fake.persist();
    expect(fake.voicemailCreates).toBe(0);
    expect(
      fake.operations.filter((operation) => operation === "voicemail.update"),
    ).toHaveLength(2);
  });

  it("rejects a different recording for the same canonical call", async () => {
    const fake = fakeDatabase({ existing: true, mismatch: true });
    await expect(fake.persist()).rejects.toEqual(
      new CanonicalVoicemailPersistenceError("CANONICAL_VOICEMAIL_IDENTITY_MISMATCH"),
    );
    expect(fake.taskUpserts).toBe(0);
  });
});
