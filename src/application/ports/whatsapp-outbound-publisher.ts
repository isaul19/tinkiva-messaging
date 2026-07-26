import type { WhatsappOutboundEnvelope } from "../../contracts/queues/whatsapp-outbound.contract.js";

export interface WhatsappOutboundPublisher {
  publish(envelope: WhatsappOutboundEnvelope): Promise<void>;
}
