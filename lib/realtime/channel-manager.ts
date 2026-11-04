export class ChannelManager {
  subscribeToTable<T extends { [key: string]: unknown }>(
    tableName: string,
    callback: (payload: T) => void,
    filter?: string
  ) {
    return { unsubscribe: () => {} };
  }

  async broadcastEvent(channelName: string, event: string, payload: unknown) {
  }

  async unsubscribe(channelName: string) {
  }

  async closeAll() {
  }
}

export const realtimeManager = new ChannelManager();
