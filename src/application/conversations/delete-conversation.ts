import type { ConversationStore } from "../ports/conversation-store.js";

export class DeleteConversation {
  readonly #store: ConversationStore;

  public constructor(store: ConversationStore) {
    this.#store = store;
  }

  public execute(input: {
    applicationId: string;
    conversationId: string;
    tenantId: string;
  }): Promise<void> {
    return this.#store.deleteConversation(input);
  }
}
