const CLIENT_INSTANCE_STORAGE_KEY = "acuity.call-center.client-instance";
const CLIENT_INSTANCE_CHANNEL = "acuity-call-center-client-instances";
const MAX_ID_ATTEMPTS = 3;

type StoragePort = Pick<Storage, "getItem" | "setItem">;
type ChannelMessage = {
  clientInstanceId: string;
  nonce: string;
  type: "OCCUPIED" | "PROBE";
};
type ChannelPort = {
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: ChannelMessage): void;
};

type ClaimOptions = {
  channelFactory?: () => ChannelPort | null;
  createId?: () => string;
  settle?: () => Promise<void>;
  storage?: StoragePort;
};

export type CallCenterClientInstance = {
  clientInstanceId: string;
  release(): void;
};

function defaultChannelFactory(): ChannelPort | null {
  if (typeof BroadcastChannel === "undefined") return null;

  const channel = new BroadcastChannel(CLIENT_INSTANCE_CHANNEL);
  const port: ChannelPort = {
    close: () => channel.close(),
    onmessage: null,
    postMessage: (message) => channel.postMessage(message),
  };
  channel.onmessage = (event) => port.onmessage?.({ data: event.data });
  return port;
}

function defaultCreateId() {
  return crypto.randomUUID();
}

function defaultSettle() {
  return new Promise<void>((resolve) => setTimeout(resolve, 25));
}

function isMessage(value: unknown): value is ChannelMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChannelMessage>;
  return (
    (message.type === "OCCUPIED" || message.type === "PROBE") &&
    typeof message.clientInstanceId === "string" &&
    typeof message.nonce === "string"
  );
}

export async function claimCallCenterClientInstance({
  channelFactory = defaultChannelFactory,
  createId = defaultCreateId,
  settle = defaultSettle,
  storage = window.sessionStorage,
}: ClaimOptions = {}): Promise<CallCenterClientInstance> {
  let clientInstanceId = storage.getItem(CLIENT_INSTANCE_STORAGE_KEY)?.trim();
  if (!clientInstanceId) {
    clientInstanceId = createId();
    storage.setItem(CLIENT_INSTANCE_STORAGE_KEY, clientInstanceId);
  }

  const channel = channelFactory();
  if (!channel) {
    return { clientInstanceId, release: () => {} };
  }

  let activeProbeNonce = "";
  let occupied = false;
  channel.onmessage = ({ data }) => {
    if (!isMessage(data) || data.clientInstanceId !== clientInstanceId) return;

    if (data.type === "PROBE") {
      channel.postMessage({ ...data, type: "OCCUPIED" });
    } else if (data.nonce === activeProbeNonce) {
      occupied = true;
    }
  };

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    occupied = false;
    activeProbeNonce = createId();
    channel.postMessage({ clientInstanceId, nonce: activeProbeNonce, type: "PROBE" });
    await settle();

    if (!occupied) {
      return {
        clientInstanceId,
        release: () => {
          channel.onmessage = null;
          channel.close();
        },
      };
    }

    clientInstanceId = createId();
    storage.setItem(CLIENT_INSTANCE_STORAGE_KEY, clientInstanceId);
  }

  channel.close();
  throw new Error("Could not claim a unique call-center client instance");
}
