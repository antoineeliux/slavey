export const OFFICE_COLOR_THEME_OPTIONS = [
  { id: "light-warm", label: "Warm" },
  { id: "dark-ide", label: "IDE" },
] as const;

export type OfficeColorTheme = (typeof OFFICE_COLOR_THEME_OPTIONS)[number]["id"];

export const DEFAULT_OFFICE_COLOR_THEME: OfficeColorTheme = "light-warm";

export function normalizeOfficeColorTheme(value: string | null | undefined): OfficeColorTheme {
  return OFFICE_COLOR_THEME_OPTIONS.some((option) => option.id === value)
    ? (value as OfficeColorTheme)
    : DEFAULT_OFFICE_COLOR_THEME;
}
