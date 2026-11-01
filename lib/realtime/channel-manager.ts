export class ChannelManager {
  subscribeToTable<T extends { [key: string]: any }>(
    tableName: string,
    callback: any,
    filter?: string
  ) {
    return { unsubscribe: () => {} };
  }

  async broadcastEvent(channelName: string, event: string, payload: any) {
  }

  async unsubscribe(channelName: string) {
  }

  async closeAll() {
  }
}

export const realtimeManager = new ChannelManager();
