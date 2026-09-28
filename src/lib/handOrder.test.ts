import { describe, expect, it } from "vitest";
import { nextHandOrderMode, orderHandCards } from "./handOrder";
import type { CardDto } from "@/protocol/game";

function card(id: string, name: string, cmc: number): CardDto {
  return { id, name, cmc, color: "", types: [] } as unknown as CardDto;
}

describe("hand display order", () => {
  const cards = [
    card("a", "Island", 0),
    card("b", "Thunderclap Drake", 2),
    card("c", "Visage Bandit", 4),
    card("d", "Hallimar Excavator", 2),
  ];
  const manual = cards.map((item) => item.id);

  it("sorts mana value ascending with lands at zero", () => {
    expect(orderHandCards(cards, "mana-value", manual).map((item) => item.id)).toEqual([
      "a", "b", "d", "c",
    ]);
  });

  it("sorts mana value descending", () => {
    expect(orderHandCards(cards, "mana-value-desc", manual).map((item) => item.id)).toEqual([
      "c", "b", "d", "a",
    ]);
  });

  it("sorts by name", () => {
    expect(orderHandCards(cards, "name", manual).map((item) => item.name)).toEqual([
      "Hallimar Excavator", "Island", "Thunderclap Drake", "Visage Bandit",
    ]);
  });

  it("cycles Default, CMC up, CMC down, Name", () => {
    expect(nextHandOrderMode("manual")).toBe("mana-value");
    expect(nextHandOrderMode("mana-value")).toBe("mana-value-desc");
    expect(nextHandOrderMode("mana-value-desc")).toBe("name");
    expect(nextHandOrderMode("name")).toBe("manual");
  });
});
