import { createHash, createHmac } from "node:crypto";

export function directHandoffToken(handoffId: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`acuity-direct-handoff:v1:${handoffId}`)
    .digest("base64url");
}

export function directHandoffTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function directHandoffRequestFingerprint(input: {
  callerPhone: string;
  routePhoneNumber: string;
  sourceCallId: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
