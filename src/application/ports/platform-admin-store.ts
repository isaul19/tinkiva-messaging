import type {
  InboundMediaConfiguration,
  OpenAICredentialStatus,
} from "../../contracts/api/platform-admin.contract.js";

export interface PlatformIntegrationAdministrationItem {
  applicationId: string;
  chatCount: number;
  createdAt: string;
  displayName: string;
  inboundMedia: InboundMediaConfiguration;
  integrationId: string;
  openAiCredential: OpenAICredentialStatus;
  provider: "TELEGRAM" | "WHATSAPP";
  providerAccountId: string;
  status: "ACTIVE" | "DISABLED" | "ERROR" | "PENDING";
  tenantId: string;
  updatedAt?: string;
}

export interface PlatformIntegrationAdministrationPage {
  items: PlatformIntegrationAdministrationItem[];
  nextCursor?: string;
}

export interface PlatformIntegrationDeletionResult {
  deletedChats: number;
  integrationId: string;
  mode: "CHATS_ONLY" | "INTEGRATION_AND_CHATS";
  status: "COMPLETED" | "IN_PROGRESS";
}

export interface PlatformAdminStore {
  deleteIntegrationData(input: {
    applicationId: string;
    integrationId: string;
    mode: "CHATS_ONLY" | "INTEGRATION_AND_CHATS";
    tenantId: string;
  }): Promise<PlatformIntegrationDeletionResult>;
  listIntegrations(input: { cursor?: string }): Promise<PlatformIntegrationAdministrationPage>;
  updateInboundMedia(input: {
    applicationId: string;
    inboundMedia: InboundMediaConfiguration;
    integrationId: string;
    tenantId: string;
  }): Promise<{ inboundMedia: InboundMediaConfiguration; updatedAt: string }>;
}
