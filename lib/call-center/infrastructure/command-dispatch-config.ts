export type CanonicalCommandDispatchConfig = Readonly<{ enabled: boolean }>;

/**
 * Durable commands are already authorized by their call's immutable CANONICAL
 * owner. Execution stays on so rollback can drain calls admitted before the
 * global switch changed; new LEGACY admissions cannot create claimable rows.
 */
export function resolveCanonicalCommandDispatchConfig(): CanonicalCommandDispatchConfig {
  return { enabled: true };
}
