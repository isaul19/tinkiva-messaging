export interface IssueRealtimeTicketRecord {
  applicationId: string;
  expiresAt: number;
  tenantId: string;
  ticketDigest: string;
}

export interface RealtimeTicketStore {
  issue(input: IssueRealtimeTicketRecord): Promise<void>;
}
