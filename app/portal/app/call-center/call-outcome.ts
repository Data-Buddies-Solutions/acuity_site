export const CALL_OUTCOME_SAVE_ERROR =
  "We couldn't save this outcome. Check the details and try again.";

export type CallOutcomeSaveResult = { ok: true } | { error: string; ok: false };

export function isCurrentCallOutcome(
  submittedToken: number,
  currentToken: number | undefined,
) {
  return submittedToken === currentToken;
}

export async function submitCallOutcome(
  save: (formData: FormData) => Promise<CallOutcomeSaveResult>,
  formData: FormData,
) {
  try {
    return await save(formData);
  } catch {
    return { error: CALL_OUTCOME_SAVE_ERROR, ok: false as const };
  }
}
