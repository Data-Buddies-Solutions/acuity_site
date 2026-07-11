import { describe, expect, it } from "bun:test";

import { claimCallCenterClientInstance } from "./call-center-client-instance";

class MemoryStorage {
  constructor(private readonly values = new Map<string, string>()) {}
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  copy() {
    return new MemoryStorage(new Map(this.values));
  }
}

class ChannelBus {
  channels = new Set<FakeChannel>();
  create = () => new FakeChannel(this);
}

class FakeChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(private readonly bus: ChannelBus) {
    bus.channels.add(this);
  }
  close() {
    this.bus.channels.delete(this);
  }
  postMessage(message: unknown) {
    for (const channel of this.bus.channels) {
      if (channel !== this) channel.onmessage?.({ data: message });
    }
  }
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? `generated-${index}`;
}

const settle = async () => {};

describe("call-center client instance", () => {
  it("persists one identity in session storage", async () => {
    const storage = new MemoryStorage();
    const first = await claimCallCenterClientInstance({
      channelFactory: () => null,
      createId: ids("client-1"),
      storage,
    });
    const second = await claimCallCenterClientInstance({
      channelFactory: () => null,
      createId: ids("unused"),
      storage,
    });

    expect(first.clientInstanceId).toBe("client-1");
    expect(second.clientInstanceId).toBe("client-1");
  });

  it("regenerates a session-storage identity copied into a second tab", async () => {
    const bus = new ChannelBus();
    const firstStorage = new MemoryStorage();
    const first = await claimCallCenterClientInstance({
      channelFactory: bus.create,
      createId: ids("shared-client", "probe-1"),
      settle,
      storage: firstStorage,
    });
    const second = await claimCallCenterClientInstance({
      channelFactory: bus.create,
      createId: ids("probe-2", "second-client", "probe-3"),
      settle,
      storage: firstStorage.copy(),
    });

    expect(first.clientInstanceId).toBe("shared-client");
    expect(second.clientInstanceId).toBe("second-client");
    first.release();
    second.release();
  });

  it("stops advertising an identity after release", async () => {
    const bus = new ChannelBus();
    const storage = new MemoryStorage();
    const first = await claimCallCenterClientInstance({
      channelFactory: bus.create,
      createId: ids("client-1", "probe-1"),
      settle,
      storage,
    });
    first.release();
    const next = await claimCallCenterClientInstance({
      channelFactory: bus.create,
      createId: ids("probe-2"),
      settle,
      storage,
    });

    expect(next.clientInstanceId).toBe("client-1");
    next.release();
  });
});
