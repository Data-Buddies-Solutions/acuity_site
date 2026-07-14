export const CALL_OUTCOME_SAVE_ERROR =
  "We couldn't save this outcome. Check the details and try again.";

export function isCurrentCallOutcome(
  submittedToken: number,
  currentToken: number | undefined,
) {
  return submittedToken === currentToken;
}

export async function submitCallOutcome(
  save: (formData: FormData) => Promise<unknown>,
  formData: FormData,
) {
  try {
    await save(formData);
    return { ok: true as const };
  } catch {
    return { error: CALL_OUTCOME_SAVE_ERROR, ok: false as const };
  }
}
