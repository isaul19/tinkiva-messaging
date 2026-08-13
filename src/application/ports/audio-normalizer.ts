export interface OpenAIAudioNormalizer {
  normalize(input: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ bytes: Uint8Array; extension: string; mimeType: string }>;
}
