export interface MediaReference {
  bucket: string;
  key: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}

export interface InboundImageImporter {
  importTelegramImage(input: {
    applicationId: string;
    fileId: string;
    integrationId: string;
    messageId: string;
    tenantId: string;
  }): Promise<MediaReference>;
  importWhatsappImage(input: {
    applicationId: string;
    integrationId: string;
    mediaId: string;
    messageId: string;
    mimeType?: string;
    providerSha256?: string;
    tenantId: string;
  }): Promise<MediaReference>;
}

export interface OutboundImageImporter {
  importImage(input: {
    acceptedMimeTypes?: string[];
    applicationId: string;
    maxSizeBytes?: number;
    mediaId?: string;
    messageId: string;
    sourceUrl?: string;
    tenantId: string;
  }): Promise<MediaReference>;
}

export interface MediaBinaryReader {
  readImage(media: MediaReference): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;
}

export interface MediaUrlSigner {
  temporaryDownloadUrl(media: MediaReference): Promise<string>;
}
