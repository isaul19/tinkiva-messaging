import type {
  WhatsappContact,
  WhatsappMessage,
  WhatsappStatus,
} from "../../contracts/providers/whatsapp.contract.js";

interface WhatsappInboundEventBase {
  applicationId: string;
  correlationId: string;
  integrationId: string;
  phoneNumberId: string;
  receivedAt: string;
  tenantId: string;
}

export type WhatsappInboundEvent =
  | (WhatsappInboundEventBase & {
      contact?: WhatsappContact;
      kind: "MESSAGE";
      message: WhatsappMessage;
    })
  | (WhatsappInboundEventBase & {
      kind: "STATUS";
      status: WhatsappStatus;
    });

export interface WhatsappInboundPublisher {
  publish(event: WhatsappInboundEvent): Promise<void>;
}
