import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueRealtimeTicketRecord } from "../../../src/application/ports/realtime-ticket-store.js";
import { CreateRealtimeTicket } from "../../../src/application/realtime/create-realtime-ticket.js";

describe("CreateRealtimeTicket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T22:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores only a digest and returns a short-lived opaque ticket", async () => {
    const records: IssueRealtimeTicketRecord[] = [];
    const store = {
      issue: vi.fn((record: IssueRealtimeTicketRecord) => {
        records.push(record);
        return Promise.resolve();
      }),
    };
    const useCase = new CreateRealtimeTicket(store, {
      ttlSeconds: 60,
      websocketUrl: "wss://realtime.example/dev",
    });

    const result = await useCase.execute({
      applicationId: "app_test",
      tenantId: "tenant_test",
    });

    expect(result.ticket).toMatch(/^rt_[0-9A-Za-z_-]{43}$/);
    expect(result.expiresAt).toBe("2026-07-26T22:01:00.000Z");
    expect(result.websocketUrl).toBe("wss://realtime.example/dev");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      applicationId: "app_test",
      expiresAt: Math.floor(new Date("2026-07-26T22:01:00.000Z").getTime() / 1_000),
      tenantId: "tenant_test",
    });
    expect(records[0]?.ticketDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(records)).not.toContain(result.ticket);
  });
});
