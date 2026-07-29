export interface BoldTextEntity {
  length: number;
  offset: number;
  type: "bold";
}

export interface ParsedBoldMarkup {
  entities: BoldTextEntity[];
  text: string;
}

export const parseBoldMarkup = (input: string): ParsedBoldMarkup => {
  const entities: BoldTextEntity[] = [];
  let cursor = 0;
  let text = "";

  while (cursor < input.length) {
    const opening = input.indexOf("**", cursor);
    if (opening === -1) {
      text += input.slice(cursor);
      break;
    }

    const closing = input.indexOf("**", opening + 2);
    if (closing === -1) {
      text += input.slice(cursor);
      break;
    }

    if (closing === opening + 2) {
      text += input.slice(cursor, opening + 2);
      cursor = opening + 2;
      continue;
    }

    text += input.slice(cursor, opening);
    const boldText = input.slice(opening + 2, closing);
    const offset = text.length;
    text += boldText;
    entities.push({
      length: boldText.length,
      offset,
      type: "bold",
    });
    cursor = closing + 2;
  }

  return { entities, text };
};

export const toWhatsappBoldMarkup = (input: string): string => {
  const parsed = parseBoldMarkup(input);
  let cursor = 0;
  let text = "";

  for (const entity of parsed.entities) {
    text += parsed.text.slice(cursor, entity.offset);
    text += `*${parsed.text.slice(entity.offset, entity.offset + entity.length)}*`;
    cursor = entity.offset + entity.length;
  }

  return text + parsed.text.slice(cursor);
};
