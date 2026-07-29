import { describe, expect, it, vi } from "vitest";

import { DeleteConversation } from "../../../src/application/conversations/delete-conversation.js";

describe("DeleteConversation", () => {
  it("delegates the application and tenant boundary to the conversation store", async () => {
    const deleteConversation = vi.fn().mockResolvedValue(undefined);
    const command = new DeleteConversation({ deleteConversation });
    const input = {
      applicationId: "app_test",
      conversationId: "conv_test",
      tenantId: "tenant_test",
    };

    await expect(command.execute(input)).resolves.toBeUndefined();
    expect(deleteConversation).toHaveBeenCalledWith(input);
  });
});
