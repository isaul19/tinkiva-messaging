import type { TelegramUpdate } from "../../contracts/providers/telegram.contract.js";

export interface TelegramInboundEvent {
  applicationId: string;
  chatId: string;
  correlationId: string;
  integrationId: string;
  receivedAt: string;
  tenantId: string;
  update: TelegramUpdate;
}

export interface TelegramInboundPublisher {
  publish(event: TelegramInboundEvent): Promise<void>;
}
