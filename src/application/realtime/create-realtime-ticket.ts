import { createHash, randomBytes } from "node:crypto";

import type { RealtimeTicketStore } from "../ports/realtime-ticket-store.js";
import type { RealtimeTicketResponse } from "../../contracts/api/realtime.contract.js";

export interface CreateRealtimeTicketCommand {
  applicationId: string;
  tenantId: string;
}

export interface CreateRealtimeTicketConfig {
  ttlSeconds: number;
  websocketUrl: string;
}

export class CreateRealtimeTicket {
  readonly #config: CreateRealtimeTicketConfig;
  readonly #store: RealtimeTicketStore;

  public constructor(store: RealtimeTicketStore, config: CreateRealtimeTicketConfig) {
    this.#config = config;
    this.#store = store;
  }

  public async execute(command: CreateRealtimeTicketCommand): Promise<RealtimeTicketResponse> {
    const ticket = `rt_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + this.#config.ttlSeconds * 1_000);

    await this.#store.issue({
      applicationId: command.applicationId,
      expiresAt: Math.floor(expiresAt.getTime() / 1_000),
      tenantId: command.tenantId,
      ticketDigest: digestTicket(ticket),
    });

    return {
      expiresAt: expiresAt.toISOString(),
      ticket,
      websocketUrl: this.#config.websocketUrl,
    };
  }
}

export const digestTicket = (ticket: string): string =>
  createHash("sha256").update(ticket, "utf8").digest("hex");
