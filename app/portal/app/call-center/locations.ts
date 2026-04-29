export type CallCenterLocation = {
  id: string;
  label: string;
  inboundNumber: string;
  outboundNumber: string;
};

export const CALL_CENTER_LOCATIONS: ReadonlyArray<CallCenterLocation> = [
  {
    id: "crystal-river",
    inboundNumber: "+12297384264",
    label: "Crystal River",
    outboundNumber: "+13523202007",
  },
  {
    id: "springhill",
    inboundNumber: "+16182265883",
    label: "Spring Hill",
    outboundNumber: "+17275919997",
  },
] as const;

export const DEFAULT_CALL_CENTER_LOCATION_ID = CALL_CENTER_LOCATIONS[0].id;

export function resolveCallCenterLocation(id: string | string[] | undefined) {
  const value = Array.isArray(id) ? id[0] : id;
  return (
    CALL_CENTER_LOCATIONS.find((location) => location.id === value) ??
    CALL_CENTER_LOCATIONS[0]
  );
}
