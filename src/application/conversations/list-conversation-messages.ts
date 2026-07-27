import type { ConversationReader } from "../ports/conversation-reader.js";
import type { ListConversationMessagesResponse } from "../../contracts/api/conversation.contract.js";

export class ListConversationMessages {
  readonly #reader: ConversationReader;

  public constructor(reader: ConversationReader) {
    this.#reader = reader;
  }

  public async execute(input: {
    applicationId: string;
    conversationId: string;
    cursor?: string;
    limit: number;
    tenantId: string;
  }): Promise<ListConversationMessagesResponse> {
    const page = await this.#reader.listMessages(input);

    return {
      conversationId: input.conversationId,
      items: page.items,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      tenantId: input.tenantId,
    };
  }
}
