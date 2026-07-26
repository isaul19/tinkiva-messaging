import type { WhatsappCredential } from "../../contracts/providers/whatsapp.contract.js";

export interface CreateWhatsappCredentialInput extends WhatsappCredential {
  applicationId: string;
  providerConnectionId: string;
  tenantId: string;
}

export interface WhatsappCredentialReader {
  get(credentialRef: string): Promise<WhatsappCredential>;
}

export interface WhatsappCredentialWriter {
  create(input: CreateWhatsappCredentialInput): Promise<string>;
  deleteImmediately(credentialRef: string): Promise<void>;
}

export type WhatsappCredentialVault = WhatsappCredentialReader & WhatsappCredentialWriter;
