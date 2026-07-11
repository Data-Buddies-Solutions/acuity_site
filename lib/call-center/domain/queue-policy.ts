export const CALL_CENTER_QUEUE_LIMITS = Object.freeze({
  ringTimeoutSec: { min: 1, max: 300 },
  maxWaitSec: { min: 1, max: 1_800 },
  wrapUpSec: { min: 0, max: 1_800 },
});

export type QueuePolicy = {
  ringTimeoutSec: number;
  maxWaitSec: number;
  wrapUpSec: number;
};

export function isValidQueuePolicy(policy: QueuePolicy) {
  return (
    Number.isInteger(policy.ringTimeoutSec) &&
    Number.isInteger(policy.maxWaitSec) &&
    Number.isInteger(policy.wrapUpSec) &&
    policy.ringTimeoutSec >= CALL_CENTER_QUEUE_LIMITS.ringTimeoutSec.min &&
    policy.ringTimeoutSec <= CALL_CENTER_QUEUE_LIMITS.ringTimeoutSec.max &&
    policy.maxWaitSec >= policy.ringTimeoutSec &&
    policy.maxWaitSec <= CALL_CENTER_QUEUE_LIMITS.maxWaitSec.max &&
    policy.wrapUpSec >= CALL_CENTER_QUEUE_LIMITS.wrapUpSec.min &&
    policy.wrapUpSec <= CALL_CENTER_QUEUE_LIMITS.wrapUpSec.max
  );
}
