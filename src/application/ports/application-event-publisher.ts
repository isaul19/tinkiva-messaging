import type { RealtimeMessageEvent } from "../../contracts/api/realtime.contract.js";

export interface ApplicationEventPublisher {
  publish(event: RealtimeMessageEvent): Promise<void>;
}
