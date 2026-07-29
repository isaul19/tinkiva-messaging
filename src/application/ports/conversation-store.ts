export interface ConversationStore {
  deleteConversation(input: {
    applicationId: string;
    conversationId: string;
    tenantId: string;
  }): Promise<void>;
}
