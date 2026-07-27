import type { ConversationReader } from "../ports/conversation-reader.js";
import type { ListConversationsResponse } from "../../contracts/api/conversation.contract.js";

export class ListConversations {
  readonly #reader: ConversationReader;

  public constructor(reader: ConversationReader) {
    this.#reader = reader;
  }

  public async execute(input: {
    applicationId: string;
    cursor?: string;
    integrationId: string;
    limit: number;
    tenantId: string;
  }): Promise<ListConversationsResponse> {
    const page = await this.#reader.listConversations(input);

    return {
      items: page.items,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      tenantId: input.tenantId,
    };
  }
}
