import { describe, expect, it, vi } from "vitest";

import { TelegramMessageApiClient } from "../../../src/infrastructure/telegram/telegram-message-api-client.js";

describe("TelegramMessageApiClient bold text", () => {
  it("sends UTF-16 bold entities in messages and image captions", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );
    const client = new TelegramMessageApiClient(fetchMock);

    await expect(
      client.sendText({
        botToken: "telegram-token",
        chatId: "123",
        text: "🔵 **PROMOCIÓN** y **stock** 🟢",
      }),
    ).resolves.toEqual({ providerMessageId: "77" });
    await expect(
      client.sendImage({
        botToken: "telegram-token",
        caption: "🟢 **Disponible**",
        chatId: "123",
        imageUrl: "https://signed.example/image.jpg",
      }),
    ).resolves.toEqual({ providerMessageId: "77" });

    const textBody = fetchMock.mock.calls[0]?.[1]?.body;
    const imageBody = fetchMock.mock.calls[1]?.[1]?.body;
    if (typeof textBody !== "string" || typeof imageBody !== "string") {
      throw new Error("Telegram requests did not contain JSON.");
    }
    expect(JSON.parse(textBody)).toEqual({
      chat_id: "123",
      entities: [
        { length: 9, offset: 3, type: "bold" },
        { length: 5, offset: 15, type: "bold" },
      ],
      text: "🔵 PROMOCIÓN y stock 🟢",
    });
    expect(JSON.parse(imageBody)).toEqual({
      caption: "🟢 Disponible",
      caption_entities: [{ length: 10, offset: 3, type: "bold" }],
      chat_id: "123",
      photo: "https://signed.example/image.jpg",
    });
  });
});
