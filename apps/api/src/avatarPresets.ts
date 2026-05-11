const AVATAR_PRESET_NAMES = ["mariner", "cedar", "ember", "linen", "violet"] as const;

export type AvatarPresetName = (typeof AVATAR_PRESET_NAMES)[number];

export function createRandomAvatarPreset() {
  return AVATAR_PRESET_NAMES[Math.floor(Math.random() * AVATAR_PRESET_NAMES.length)]!;
}
