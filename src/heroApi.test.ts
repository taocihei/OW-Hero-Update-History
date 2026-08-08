import { describe, expect, it } from "vitest";
import { normalizeHeroRosterPayload } from "./heroApi";

describe("hero roster incremental upgrade", () => {
  it("accepts a hero that is not present in the bundled application", () => {
    const heroes = normalizeHeroRosterPayload({
      english: [{
        key: "future-hero",
        name: "Future Hero",
        portrait: "https://example.invalid/future-hero.png",
        role: "support",
        gamemodes: ["quickplay", "competitive"],
      }],
      chinese: [{
        key: "future-hero",
        name: "未来英雄",
      }],
    });

    expect(heroes).toEqual([{
      key: "future-hero",
      name: "未来英雄",
      englishName: "Future Hero",
      portrait: "https://example.invalid/future-hero.png",
      role: "support",
      gamemodes: ["quickplay", "competitive"],
    }]);
  });

  it("does not add heroes that are absent from normal play modes", () => {
    expect(normalizeHeroRosterPayload([{
      key: "event-only",
      name: "Event Only",
      portrait: "https://example.invalid/event-only.png",
      role: "damage",
      gamemodes: ["event"],
    }])).toEqual([]);
  });
});
