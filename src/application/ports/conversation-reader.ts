import type {
  ConversationListItem,
  ConversationMessage,
} from "../../contracts/api/conversation.contract.js";

export interface ConversationPage {
  items: ConversationListItem[];
  nextCursor?: string;
}

export interface ConversationMessagePage {
  items: ConversationMessage[];
  nextCursor?: string;
}

export interface ConversationReader {
  listConversations(input: {
    applicationId: string;
    cursor?: string;
    integrationId: string;
    limit: number;
    tenantId: string;
  }): Promise<ConversationPage>;
  listMessages(input: {
    applicationId: string;
    conversationId: string;
    cursor?: string;
    limit: number;
    tenantId: string;
  }): Promise<ConversationMessagePage>;
}
