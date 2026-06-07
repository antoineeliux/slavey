import { describe, expect, it } from "vitest";

import {
  DEFAULT_OWNER_AVATAR_APPEARANCE,
  avatarAppearanceFingerprint,
  avatarAppearanceLabel,
  avatarPalette,
  cycleAvatarAppearance,
} from "./avatarAppearance";

describe("avatarAppearance", () => {
  it("cycles each appearance option in both directions", () => {
    const nextHair = cycleAvatarAppearance(DEFAULT_OWNER_AVATAR_APPEARANCE, "hairStyle", 1);
    expect(nextHair.hairStyle).toBe("bob");

    const previousHair = cycleAvatarAppearance(DEFAULT_OWNER_AVATAR_APPEARANCE, "hairStyle", -1);
    expect(previousHair.hairStyle).toBe("pony");
  });

  it("exposes user-facing option labels", () => {
    expect(avatarAppearanceLabel("outfitStyle", "technical")).toBe("Technical");
    expect(avatarAppearanceLabel("faceStyle", "focused")).toBe("Focused");
  });

  it("creates stable fingerprints and palettes", () => {
    const appearance = {
      ...DEFAULT_OWNER_AVATAR_APPEARANCE,
      outfitStyle: "evening" as const,
      skinTone: "deep" as const,
    };

    expect(avatarAppearanceFingerprint(appearance)).toBe("crop:calm:standard:tailored:evening:deep");
    expect(avatarPalette(appearance)).toMatchObject({
      skin: "#8f5d42",
      shirt: "#c798ff",
      jacket: "#2c2336",
    });
  });
});
