import { describe, expect, it, vi } from "vitest";

import { ProcessAudioMediaEnrichmentJob } from "../../../src/application/media/process-audio-media-enrichment-job.js";
import { ProcessImageMediaEnrichmentJob } from "../../../src/application/media/process-image-media-enrichment-job.js";
import { ResolveInboundMediaEnrichment } from "../../../src/application/media/resolve-inbound-media-enrichment.js";
import type { MediaEnrichmentStore } from "../../../src/application/ports/media-enrichment-store.js";
import type {
  AudioMediaEnrichmentJob,
  ImageMediaEnrichmentJob,
} from "../../../src/contracts/queues/media-enrichment.contract.js";

const common = {
  applicationId: "app_test",
  conversationId: "conv_test",
  integrationId: "int_test",
  messageId: "msg_test",
  messageSortKey: "MESSAGE#2026-08-12T12:00:00.000Z#msg_test",
  tenantId: "tenant_test",
};

const imageJob: ImageMediaEnrichmentJob = {
  ...common,
  caption: "Una foto",
  media: {
    bucket: "media-bucket",
    key: "tenants/test/image.jpg",
    mimeType: "image/jpeg",
    sha256: "a".repeat(64),
    sizeBytes: 100,
  },
  type: "IMAGE",
};

const audioJob: AudioMediaEnrichmentJob = {
  ...common,
  media: {
    bucket: "media-bucket",
    key: "tenants/test/audio.webm",
    mimeType: "audio/webm",
    sha256: "b".repeat(64),
    sizeBytes: 100,
  },
  type: "AUDIO",
};

describe("media enrichment application services", () => {
  const enrichmentStore = (
    overrides: Partial<MediaEnrichmentStore> = {},
  ): MediaEnrichmentStore => ({
    claim: vi.fn<MediaEnrichmentStore["claim"]>().mockResolvedValue({ leaseId: "lease_test" }),
    complete: vi.fn<MediaEnrichmentStore["complete"]>(),
    fail: vi.fn<MediaEnrichmentStore["fail"]>(),
    forceFail: vi.fn<MediaEnrichmentStore["forceFail"]>(),
    release: vi.fn<MediaEnrichmentStore["release"]>(),
    ...overrides,
  });

  it("completes image enrichment with generated alternative text", async () => {
    const complete = vi.fn().mockResolvedValue("UPDATED");
    const generate = vi.fn().mockResolvedValue("Descripción útil");
    const service = new ProcessImageMediaEnrichmentJob({ generate }, enrichmentStore({ complete }));

    await expect(service.execute(imageJob)).resolves.toBe("COMPLETED");
    expect(generate).toHaveBeenCalledWith({
      applicationId: imageJob.applicationId,
      caption: "Una foto",
      integrationId: imageJob.integrationId,
      media: imageJob.media,
      tenantId: imageJob.tenantId,
    });
    expect(complete).toHaveBeenCalledWith({
      alternativeText: "Descripción útil",
      claim: { leaseId: "lease_test" },
      job: imageJob,
    });
  });

  it("completes audio enrichment with generated transcription", async () => {
    const complete = vi.fn().mockResolvedValue("UPDATED");
    const generate = vi.fn().mockResolvedValue("Hola mundo");
    const service = new ProcessAudioMediaEnrichmentJob({ generate }, enrichmentStore({ complete }));

    await expect(service.execute(audioJob)).resolves.toBe("COMPLETED");
    expect(generate).toHaveBeenCalledWith({
      applicationId: audioJob.applicationId,
      integrationId: audioJob.integrationId,
      media: audioJob.media,
      tenantId: audioJob.tenantId,
    });
    expect(complete).toHaveBeenCalledWith({
      alternativeText: "Hola mundo",
      claim: { leaseId: "lease_test" },
      job: audioJob,
    });
  });

  it("marks permanent media errors failed and propagates retryable errors", async () => {
    const fail = vi.fn().mockResolvedValue("UPDATED");
    const permanent = new ProcessAudioMediaEnrichmentJob(
      { generate: vi.fn().mockRejectedValue(new RangeError("unsupported")) },
      enrichmentStore({ fail }),
    );
    await expect(permanent.execute(audioJob)).resolves.toBe("FAILED");
    expect(fail).toHaveBeenCalledWith(audioJob, { leaseId: "lease_test" });

    const forbidden = Object.assign(new Error("OpenAI denied the request"), { status: 403 });
    const forbiddenRequest = new ProcessImageMediaEnrichmentJob(
      { generate: vi.fn().mockRejectedValue(forbidden) },
      enrichmentStore({ fail }),
    );
    await expect(forbiddenRequest.execute(imageJob)).resolves.toBe("FAILED");

    const transientError = Object.assign(new Error("OpenAI rate limited"), { status: 429 });
    const transient = new ProcessImageMediaEnrichmentJob(
      { generate: vi.fn().mockRejectedValue(transientError) },
      enrichmentStore(),
    );
    await expect(transient.execute(imageJob)).rejects.toBe(transientError);
  });

  it("ignores stale completion and failure updates", async () => {
    const completed = new ProcessAudioMediaEnrichmentJob(
      { generate: vi.fn().mockResolvedValue("Transcripción") },
      enrichmentStore({ complete: vi.fn().mockResolvedValue("IGNORED") }),
    );
    await expect(completed.execute(audioJob)).resolves.toBe("IGNORED");

    const failed = new ProcessImageMediaEnrichmentJob(
      { generate: vi.fn().mockRejectedValue(new RangeError("unsupported")) },
      enrichmentStore({ fail: vi.fn().mockResolvedValue("IGNORED") }),
    );
    await expect(failed.execute(imageJob)).resolves.toBe("IGNORED");
  });

  it("does not disclose media to the generator when a pending inbound job is stale", async () => {
    const generate = vi.fn();
    const service = new ProcessImageMediaEnrichmentJob(
      { generate },
      enrichmentStore({ claim: vi.fn().mockResolvedValue("IGNORED") }),
    );

    await expect(service.execute(imageJob)).resolves.toBe("IGNORED");
    expect(generate).not.toHaveBeenCalled();
  });

  it("resolves the independently configured inbound audio and image flags", async () => {
    const get = vi.fn().mockResolvedValue({
      inboundMedia: {
        audioAlternativeText: true,
        imageAlternativeText: false,
      },
    });
    const resolver = new ResolveInboundMediaEnrichment({ get });

    await expect(
      resolver.requested({
        ...common,
        media: audioJob.media,
        type: "AUDIO",
      }),
    ).resolves.toBe(true);
    await expect(
      resolver.requested({
        ...common,
        caption: "Una foto",
        media: imageJob.media,
        type: "IMAGE",
      }),
    ).resolves.toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
