import type { TelegramOutboundEnvelope } from "../../contracts/queues/telegram-outbound.contract.js";

export interface TelegramOutboundPublisher {
  publish(envelope: TelegramOutboundEnvelope): Promise<void>;
}
