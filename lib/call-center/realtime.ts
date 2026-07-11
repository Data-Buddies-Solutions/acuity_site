const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const MAX_REVISION_DIGITS = 19;
const ONE = BigInt(1);

export type Revisioned = { revision: bigint };

export type ResumePlan =
  | { cursor: bigint; kind: "resume" | "tail" }
  | {
      cursor: bigint;
      kind: "reset";
      reason: "AHEAD_OF_STREAM" | "INVALID_CURSOR" | "RETENTION_GAP";
    };

export function parseRevision(value: string | null | undefined) {
  const normalized = value?.trim();

  if (
    !normalized ||
    normalized.length > MAX_REVISION_DIGITS ||
    !/^(0|[1-9]\d*)$/.test(normalized)
  ) {
    return null;
  }

  const revision = BigInt(normalized);
  return revision <= MAX_POSTGRES_BIGINT ? revision : null;
}

export function requestedRevision(lastEventId: string | null, after: string | null) {
  const raw = lastEventId?.trim() || after?.trim() || null;

  return {
    provided: raw !== null,
    revision: parseRevision(raw),
  };
}

export function revisionString(revision: bigint) {
  return revision.toString(10);
}

export function orderByRevision<T extends Revisioned>(events: readonly T[]) {
  return [...events].sort((left, right) =>
    left.revision < right.revision ? -1 : left.revision > right.revision ? 1 : 0,
  );
}

export function resumePlan({
  latestRevision,
  requested,
  requestedProvided,
  retentionFloor,
}: {
  latestRevision: bigint;
  requested: bigint | null;
  requestedProvided: boolean;
  retentionFloor: bigint | null;
}): ResumePlan {
  if (requestedProvided && requested === null) {
    return { cursor: latestRevision, kind: "reset", reason: "INVALID_CURSOR" };
  }

  if (requested === null) {
    return { cursor: latestRevision, kind: "tail" };
  }

  if (requested > latestRevision) {
    return { cursor: latestRevision, kind: "reset", reason: "AHEAD_OF_STREAM" };
  }

  if (retentionFloor !== null && requested + ONE < retentionFloor) {
    return { cursor: latestRevision, kind: "reset", reason: "RETENTION_GAP" };
  }

  return { cursor: requested, kind: "resume" };
}

export function advanceRevision(cursor: bigint, candidate: bigint) {
  if (candidate <= cursor) {
    return { cursor, emit: false };
  }

  // Revisions are global. Tenant filtering can create valid numeric gaps.
  return { cursor: candidate, emit: true };
}
