import { describe, expect, it } from "vitest";

import { parseBoldMarkup, toWhatsappBoldMarkup } from "../../../src/shared/text/bold-markup.js";

describe("bold markup", () => {
  it("parses multiple bold ranges using Telegram UTF-16 offsets", () => {
    expect(parseBoldMarkup("🔵 **PROMOCIÓN** y **stock** 🟢")).toEqual({
      entities: [
        { length: 9, offset: 3, type: "bold" },
        { length: 5, offset: 15, type: "bold" },
      ],
      text: "🔵 PROMOCIÓN y stock 🟢",
    });
  });

  it("converts unified bold markup to WhatsApp native markup", () => {
    expect(toWhatsappBoldMarkup("🔵 **PROMOCIÓN** y **stock** 🟢")).toBe(
      "🔵 *PROMOCIÓN* y *stock* 🟢",
    );
  });

  it("preserves unmatched and empty markers as literal text", () => {
    expect(parseBoldMarkup("Antes **sin cierre")).toEqual({
      entities: [],
      text: "Antes **sin cierre",
    });
    expect(parseBoldMarkup("Vacío ****")).toEqual({
      entities: [],
      text: "Vacío ****",
    });
  });
});
