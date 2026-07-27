import type { RealtimeMessageEvent } from "../../contracts/api/realtime.contract.js";

export interface RealtimeConnectionSender {
  send(connectionId: string, event: RealtimeMessageEvent): Promise<"GONE" | "SENT">;
}
