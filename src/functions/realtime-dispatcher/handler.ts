import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import type { RealtimeConnectionSender } from "../../application/ports/realtime-connection-sender.js";
import type { RealtimeConnectionStore } from "../../application/ports/realtime-connection-store.js";
import {
  realtimeMessageEventSchema,
  type RealtimeMessageEvent,
} from "../../contracts/api/realtime.contract.js";
import { ApiGatewayRealtimeConnectionSender } from "../../infrastructure/apigateway/api-gateway-realtime-connection-sender.js";
import { dynamoDocumentClient } from "../../infrastructure/aws/clients.js";
import { DynamoRealtimeStore } from "../../infrastructure/dynamodb/dynamo-realtime-store.js";
import { loadRealtimeDispatcherRuntimeConfig } from "../../shared/config/realtime-dispatcher-runtime-config.js";

const logger = new Logger({
  serviceName: "realtime-dispatcher",
});

export interface RealtimeDispatcherHandlerDependencies {
  sender: RealtimeConnectionSender;
  store: RealtimeConnectionStore;
}

export const createRealtimeDispatcherHandler =
  ({ sender, store }: RealtimeDispatcherHandlerDependencies) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    const connectionCache = new Map<string, Awaited<ReturnType<RealtimeConnectionStore["list"]>>>();

    for (const record of event.Records) {
      try {
        const applicationEvent = realtimeMessageEventSchema.parse(
          JSON.parse(record.body) as unknown,
        );
        const cacheKey = `${applicationEvent.applicationId}:${applicationEvent.tenantId}`;
        const connections =
          connectionCache.get(cacheKey) ??
          (await store.list(applicationEvent.applicationId, applicationEvent.tenantId));
        connectionCache.set(cacheKey, connections);
        await dispatchEvent(applicationEvent, connections, sender, store);
      } catch (error) {
        logger.error("Failed to dispatch an application event in realtime.", {
          error,
          messageId: record.messageId,
        });
        batchItemFailures.push({
          itemIdentifier: record.messageId,
        });
      }
    }

    return { batchItemFailures };
  };

const dispatchEvent = async (
  event: RealtimeMessageEvent,
  connections: Awaited<ReturnType<RealtimeConnectionStore["list"]>>,
  sender: RealtimeConnectionSender,
  store: RealtimeConnectionStore,
): Promise<void> => {
  const now = Math.floor(Date.now() / 1_000);

  await Promise.all(
    connections.map(async (connection) => {
      if (connection.expiresAt < now) {
        await store.disconnect(connection.connectionId);
        return;
      }

      const result = await sender.send(connection.connectionId, event);
      if (result === "GONE") await store.disconnect(connection.connectionId);
    }),
  );
};

const config = loadRealtimeDispatcherRuntimeConfig();
const store = new DynamoRealtimeStore(dynamoDocumentClient, config.CONTROL_TABLE);

export const main = createRealtimeDispatcherHandler({
  sender: new ApiGatewayRealtimeConnectionSender(config.WEBSOCKET_MANAGEMENT_ENDPOINT),
  store,
});
