# Acuity Health Practice Operations

This context describes the practice-facing operational work and communication
records managed by Acuity Health.

## Language

**Action item**:
A missed call, voicemail, callback, follow-up, or note that still requires staff
attention. It is distinct from the underlying call-history record.
_Avoid_: Task

**Resolved action item**:
An action item that no longer requires staff attention. Resolution removes it
from Needs Action while preserving its call and audit history.
_Avoid_: Deleted action item

**Caller thread**:
The single Needs Action representation for all currently open action items
associated with one normalized phone number. It represents the latest activity
while retaining the thread's open-item count.
_Avoid_: Number profile, caller profile
