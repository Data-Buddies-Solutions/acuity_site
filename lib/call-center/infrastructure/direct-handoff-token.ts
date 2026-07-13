import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

export function matchesDirectHandoffToken(token: string, tokenHash: string) {
  return matchesDirectHandoffTokenHash(directHandoffTokenHash(token), tokenHash);
}

export function matchesDirectHandoffTokenHash(candidateHash: string, tokenHash: string) {
  const actual = Buffer.from(candidateHash);
  const expected = Buffer.from(tokenHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
