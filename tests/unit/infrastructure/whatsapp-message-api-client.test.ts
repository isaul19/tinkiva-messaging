import { describe, expect, it, vi } from "vitest";

import { WhatsappMessageApiClient } from "../../../src/infrastructure/whatsapp/whatsapp-message-api-client.js";

describe("WhatsappMessageApiClient media uploads", () => {
  it("uploads binary multipart media and sends the image by Media ID", async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "meta-media-1" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ id: "wamid.image" }],
            messaging_product: "whatsapp",
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );
    const client = new WhatsappMessageApiClient(fetchMock);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);

    await expect(
      client.uploadImage({
        accessToken: "t".repeat(32),
        bytes,
        graphApiVersion: "v25.0",
        mimeType: "image/jpeg",
        phoneNumberId: "778899",
      }),
    ).resolves.toEqual({ providerMediaId: "meta-media-1" });

    const uploadCall = fetchMock.mock.calls[0];
    expect(uploadCall?.[0]).toBe("https://graph.facebook.com/v25.0/778899/media");
    const uploadOptions = uploadCall?.[1];
    expect(uploadOptions?.headers).toEqual({
      authorization: `Bearer ${"t".repeat(32)}`,
    });
    expect(uploadOptions?.body).toBeInstanceOf(FormData);
    const form = uploadOptions?.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    if (!(file instanceof Blob)) throw new Error("The upload did not contain a binary file.");
    expect(file.type).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);

    await expect(
      client.sendImage({
        accessToken: "t".repeat(32),
        caption: "🔵 **POLO PRUEBA**",
        graphApiVersion: "v25.0",
        mediaId: "meta-media-1",
        phoneNumberId: "778899",
        recipientId: "573001112233",
      }),
    ).resolves.toEqual({ providerMessageId: "wamid.image" });

    const sendOptions = fetchMock.mock.calls[1]?.[1];
    if (typeof sendOptions?.body !== "string") {
      throw new Error("The WhatsApp message request did not contain JSON.");
    }
    expect(JSON.parse(sendOptions.body)).toMatchObject({
      image: {
        caption: "🔵 *POLO PRUEBA*",
        id: "meta-media-1",
      },
      messaging_product: "whatsapp",
      type: "image",
    });
  });

  it("converts unified bold text to WhatsApp native markup", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [{ id: "wamid.text" }],
          messaging_product: "whatsapp",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    const client = new WhatsappMessageApiClient(fetchMock);

    await expect(
      client.sendText({
        accessToken: "t".repeat(32),
        graphApiVersion: "v25.0",
        phoneNumberId: "778899",
        recipientId: "573001112233",
        text: "🟢 **Producto disponible**",
      }),
    ).resolves.toEqual({ providerMessageId: "wamid.text" });

    const body = fetchMock.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") throw new Error("WhatsApp request did not contain JSON.");
    expect(JSON.parse(body)).toMatchObject({
      text: {
        body: "🟢 *Producto disponible*",
      },
      type: "text",
    });
  });

  it("maps a rejected Meta media upload to MEDIA_INVALID", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 131_053 } }), {
        headers: { "content-type": "application/json" },
        status: 400,
      }),
    );
    const client = new WhatsappMessageApiClient(fetchMock);

    await expect(
      client.uploadImage({
        accessToken: "t".repeat(32),
        bytes: new Uint8Array([0xff, 0xd8]),
        graphApiVersion: "v25.0",
        mimeType: "image/jpeg",
        phoneNumberId: "778899",
      }),
    ).rejects.toMatchObject({
      code: "MEDIA_INVALID",
      retryable: false,
      statusCode: 422,
    });
  });
});
