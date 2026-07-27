import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

import type { RealtimeConnectionSender } from "../../application/ports/realtime-connection-sender.js";
import type { RealtimeMessageEvent } from "../../contracts/api/realtime.contract.js";

export class ApiGatewayRealtimeConnectionSender implements RealtimeConnectionSender {
  readonly #client: ApiGatewayManagementApiClient;

  public constructor(endpoint: string) {
    this.#client = new ApiGatewayManagementApiClient({ endpoint });
  }

  public async send(connectionId: string, event: RealtimeMessageEvent): Promise<"GONE" | "SENT"> {
    try {
      await this.#client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify(event), "utf8"),
        }),
      );
      return "SENT";
    } catch (error) {
      if (error instanceof Error && error.name === "GoneException") return "GONE";
      throw error;
    }
  }
}
