export const HAIR_STYLE_OPTIONS = [
  { id: "crop", label: "Crop" },
  { id: "bob", label: "Bob" },
  { id: "long", label: "Long" },
  { id: "curls", label: "Curls" },
  { id: "pony", label: "Pony" },
] as const;

export const FACE_STYLE_OPTIONS = [
  { id: "calm", label: "Calm" },
  { id: "smile", label: "Smile" },
  { id: "focused", label: "Focused" },
  { id: "bold", label: "Bold" },
] as const;

export const BODY_SHAPE_OPTIONS = [
  { id: "standard", label: "Standard" },
  { id: "slim", label: "Slim" },
  { id: "broad", label: "Broad" },
] as const;

export const LEG_STYLE_OPTIONS = [
  { id: "tailored", label: "Tailored" },
  { id: "joggers", label: "Joggers" },
  { id: "boots", label: "Boots" },
] as const;

export const OUTFIT_STYLE_OPTIONS = [
  { id: "executive", label: "Executive" },
  { id: "creative", label: "Creative" },
  { id: "technical", label: "Technical" },
  { id: "evening", label: "Evening" },
] as const;

export const SKIN_TONE_OPTIONS = [
  { id: "warm", label: "Warm" },
  { id: "deep", label: "Deep" },
  { id: "olive", label: "Olive" },
  { id: "fair", label: "Fair" },
] as const;

export type HairStyleId = (typeof HAIR_STYLE_OPTIONS)[number]["id"];
export type FaceStyleId = (typeof FACE_STYLE_OPTIONS)[number]["id"];
export type BodyShapeId = (typeof BODY_SHAPE_OPTIONS)[number]["id"];
export type LegStyleId = (typeof LEG_STYLE_OPTIONS)[number]["id"];
export type OutfitStyleId = (typeof OUTFIT_STYLE_OPTIONS)[number]["id"];
export type SkinToneId = (typeof SKIN_TONE_OPTIONS)[number]["id"];

export type OwnerAvatarAppearance = {
  hairStyle: HairStyleId;
  faceStyle: FaceStyleId;
  bodyShape: BodyShapeId;
  legStyle: LegStyleId;
  outfitStyle: OutfitStyleId;
  skinTone: SkinToneId;
};

export type OwnerAvatarAppearanceKey = keyof OwnerAvatarAppearance;

export const DEFAULT_OWNER_AVATAR_APPEARANCE: OwnerAvatarAppearance = {
  hairStyle: "crop",
  faceStyle: "calm",
  bodyShape: "standard",
  legStyle: "tailored",
  outfitStyle: "executive",
  skinTone: "warm",
};

export const AVATAR_APPEARANCE_CONTROLS: Array<{
  key: OwnerAvatarAppearanceKey;
  label: string;
  options: readonly { id: string; label: string }[];
}> = [
  { key: "hairStyle", label: "Hair", options: HAIR_STYLE_OPTIONS },
  { key: "faceStyle", label: "Face", options: FACE_STYLE_OPTIONS },
  { key: "skinTone", label: "Skin", options: SKIN_TONE_OPTIONS },
  { key: "bodyShape", label: "Body", options: BODY_SHAPE_OPTIONS },
  { key: "legStyle", label: "Legs", options: LEG_STYLE_OPTIONS },
  { key: "outfitStyle", label: "Clothes", options: OUTFIT_STYLE_OPTIONS },
];

export function cycleAvatarAppearance(
  appearance: OwnerAvatarAppearance,
  key: OwnerAvatarAppearanceKey,
  direction: -1 | 1,
): OwnerAvatarAppearance {
  const control = AVATAR_APPEARANCE_CONTROLS.find((item) => item.key === key);
  if (!control) return appearance;
  const currentIndex = control.options.findIndex((option) => option.id === appearance[key]);
  const nextIndex =
    (Math.max(0, currentIndex) + direction + control.options.length) % control.options.length;
  return {
    ...appearance,
    [key]: control.options[nextIndex].id,
  };
}

export function avatarAppearanceLabel(
  key: OwnerAvatarAppearanceKey,
  value: string,
): string {
  const control = AVATAR_APPEARANCE_CONTROLS.find((item) => item.key === key);
  return control?.options.find((option) => option.id === value)?.label ?? value;
}

export function avatarAppearanceFingerprint(appearance: OwnerAvatarAppearance): string {
  return [
    appearance.hairStyle,
    appearance.faceStyle,
    appearance.bodyShape,
    appearance.legStyle,
    appearance.outfitStyle,
    appearance.skinTone,
  ].join(":");
}

export function avatarPalette(appearance: OwnerAvatarAppearance): {
  skin: string;
  skinHex: number;
  hair: string;
  hairHex: number;
  shirt: string;
  shirtHex: number;
  jacket: string;
  jacketHex: number;
  pants: string;
  pantsHex: number;
  shoes: string;
  shoesHex: number;
} {
  type ColorPair = readonly [string, number];
  type OutfitPalette = {
    shirt: ColorPair;
    jacket: ColorPair;
    pants: ColorPair;
    shoes: ColorPair;
  };
  const skin = {
    warm: ["#d99a73", 0xd99a73],
    deep: ["#8f5d42", 0x8f5d42],
    olive: ["#b58b61", 0xb58b61],
    fair: ["#edba91", 0xedba91],
  }[appearance.skinTone] as [string, number];
  const hair = {
    crop: ["#1c2228", 0x1c2228],
    bob: ["#54351f", 0x54351f],
    long: ["#2a211d", 0x2a211d],
    curls: ["#654127", 0x654127],
    pony: ["#11181d", 0x11181d],
  }[appearance.hairStyle] as [string, number];
  const outfits = {
    executive: {
      shirt: ["#f1eadf", 0xf1eadf],
      jacket: ["#1f3035", 0x1f3035],
      pants: ["#202a30", 0x202a30],
      shoes: ["#111718", 0x111718],
    },
    creative: {
      shirt: ["#d6a94f", 0xd6a94f],
      jacket: ["#5e6c63", 0x5e6c63],
      pants: ["#34443d", 0x34443d],
      shoes: ["#232b29", 0x232b29],
    },
    technical: {
      shirt: ["#75bdff", 0x75bdff],
      jacket: ["#1c3f4a", 0x1c3f4a],
      pants: ["#173038", 0x173038],
      shoes: ["#0d1416", 0x0d1416],
    },
    evening: {
      shirt: ["#c798ff", 0xc798ff],
      jacket: ["#2c2336", 0x2c2336],
      pants: ["#211c29", 0x211c29],
      shoes: ["#141017", 0x141017],
    },
  } satisfies Record<OutfitStyleId, OutfitPalette>;
  const outfit = outfits[appearance.outfitStyle];

  return {
    skin: skin[0],
    skinHex: skin[1],
    hair: hair[0],
    hairHex: hair[1],
    shirt: outfit.shirt[0],
    shirtHex: outfit.shirt[1],
    jacket: outfit.jacket[0],
    jacketHex: outfit.jacket[1],
    pants: outfit.pants[0],
    pantsHex: outfit.pants[1],
    shoes: outfit.shoes[0],
    shoesHex: outfit.shoes[1],
  };
}
