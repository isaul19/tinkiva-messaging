export interface RealtimeConnection {
  applicationId: string;
  connectionId: string;
  expiresAt: number;
  tenantId: string;
}

export interface RealtimeConnectionStore {
  connect(input: {
    connectedAt: string;
    connectionId: string;
    expiresAt: number;
    nowEpochSeconds: number;
    ticketDigest: string;
  }): Promise<RealtimeConnection | undefined>;
  disconnect(connectionId: string): Promise<void>;
  list(applicationId: string, tenantId: string): Promise<RealtimeConnection[]>;
}
