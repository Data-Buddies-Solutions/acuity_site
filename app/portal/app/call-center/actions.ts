"use server";

import { revalidatePath } from "next/cache";

import {
  getCurrentPracticeCallCenterContext,
  setCallCenterEnabledForCurrentPractice,
} from "@/lib/call-center";
import { prisma } from "@/lib/prisma";

export async function enableCallCenterAction() {
  await setCallCenterEnabledForCurrentPractice(true);
  revalidatePath("/portal/app/call-center");
}

export async function disableCallCenterAction() {
  await setCallCenterEnabledForCurrentPractice(false);
  revalidatePath("/portal/app/call-center");
}

export async function resolveMissedCallAction(formData: FormData) {
  const context = await getCurrentPracticeCallCenterContext();
  const id = String(formData.get("id") || "");

  if (!context || !id) {
    return;
  }

  await prisma.callCenterMissedCall.updateMany({
    data: {
      calledBack: true,
      resolvedAt: new Date(),
    },
    where: {
      id,
      practiceId: context.practice.id,
    },
  });

  revalidatePath("/portal/app/call-center");
}

export async function resolveVoicemailAction(formData: FormData) {
  const context = await getCurrentPracticeCallCenterContext();
  const id = String(formData.get("id") || "");

  if (!context || !id) {
    return;
  }

  await prisma.callCenterVoicemail.updateMany({
    data: {
      resolvedAt: new Date(),
    },
    where: {
      id,
      practiceId: context.practice.id,
    },
  });

  revalidatePath("/portal/app/call-center");
}
