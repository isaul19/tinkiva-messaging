export const conversationIndexPartitionKey = (
  applicationId: string,
  tenantId: string,
  integrationId: string,
): string =>
  `APPLICATION#${applicationId}#TENANT#${tenantId}#INTEGRATION#${integrationId}#CONVERSATIONS`;

export const conversationIndexSortKey = (lastMessageAt: string, conversationId: string): string =>
  `${lastMessageAt}#${conversationId}`;

export const buildConversationIndexKeys = (input: {
  applicationId: string;
  conversationId: string;
  integrationId: string;
  lastMessageAt: string;
  tenantId: string;
}): { GSI1PK: string; GSI1SK: string } => ({
  GSI1PK: conversationIndexPartitionKey(input.applicationId, input.tenantId, input.integrationId),
  GSI1SK: conversationIndexSortKey(input.lastMessageAt, input.conversationId),
});
