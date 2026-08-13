export interface MediaReference {
  bucket: string;
  key: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}

export interface InboundImageImporter {
  importTelegramAudio?(input: {
    applicationId: string;
    fileId: string;
    integrationId: string;
    messageId: string;
    mimeType?: string;
    tenantId: string;
  }): Promise<MediaReference>;
  importTelegramImage(input: {
    applicationId: string;
    fileId: string;
    integrationId: string;
    messageId: string;
    tenantId: string;
  }): Promise<MediaReference>;
  importWhatsappAudio?(input: {
    applicationId: string;
    integrationId: string;
    mediaId: string;
    messageId: string;
    mimeType?: string;
    providerSha256?: string;
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

export interface OutboundAudioImporter {
  importAudio(input: {
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
  readAudio?(media: MediaReference): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;
  readImage(media: MediaReference): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;
}

export interface EnrichmentMediaReader {
  readMedia(input: { applicationId: string; media: MediaReference; tenantId: string }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;
}

export interface MediaUrlSigner {
  temporaryDownloadUrl(media: MediaReference): Promise<string>;
}

export interface MediaObjectDeleter {
  deleteMedia(input: {
    applicationId: string;
    media: MediaReference[];
    tenantId: string;
  }): Promise<void>;
}
