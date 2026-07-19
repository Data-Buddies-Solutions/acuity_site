import { CallCenterRouteState } from "./CallCenterRouteState";

export default function CallCenterLoading() {
  return (
    <CallCenterRouteState
      busy
      message="Loading authorized queues and outbound calling configuration."
      title="Starting Call Center"
    />
  );
}
