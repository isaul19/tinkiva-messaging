import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { z } from "zod";

import { digestTicket } from "../../application/realtime/create-realtime-ticket.js";
import { dynamoDocumentClient } from "../../infrastructure/aws/clients.js";
import { DynamoRealtimeStore } from "../../infrastructure/dynamodb/dynamo-realtime-store.js";
import { loadRealtimeConnectionRuntimeConfig } from "../../shared/config/realtime-connection-runtime-config.js";

const ticketSchema = z.string().regex(/^rt_[0-9A-Za-z_-]{32,120}$/);
const CONNECTION_TTL_SECONDS = 7_500;

export interface RealtimeConnectionHandlerDependencies {
  store: Pick<DynamoRealtimeStore, "connect" | "disconnect">;
}

export const createRealtimeConnectionHandler =
  ({ store }: RealtimeConnectionHandlerDependencies) =>
  async (event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> => {
    const routeKey = event.requestContext.routeKey;
    const connectionId = event.requestContext.connectionId;

    if (routeKey === "$connect") {
      const ticket = ticketSchema.safeParse(event.queryStringParameters?.ticket);
      if (!ticket.success) return { statusCode: 401 };

      const now = new Date();
      const connection = await store.connect({
        connectedAt: now.toISOString(),
        connectionId,
        expiresAt: Math.floor(now.getTime() / 1_000) + CONNECTION_TTL_SECONDS,
        nowEpochSeconds: Math.floor(now.getTime() / 1_000),
        ticketDigest: digestTicket(ticket.data),
      });

      return { statusCode: connection === undefined ? 401 : 200 };
    }

    if (routeKey === "$disconnect") {
      await store.disconnect(connectionId);
      return { statusCode: 200 };
    }

    if (routeKey === "ping") {
      return {
        body: JSON.stringify({
          type: "pong",
          occurredAt: new Date().toISOString(),
        }),
        statusCode: 200,
      };
    }

    return {
      body: JSON.stringify({ code: "REALTIME_ROUTE_NOT_FOUND" }),
      statusCode: 400,
    };
  };

const config = loadRealtimeConnectionRuntimeConfig();

export const main = createRealtimeConnectionHandler({
  store: new DynamoRealtimeStore(dynamoDocumentClient, config.CONTROL_TABLE),
});
