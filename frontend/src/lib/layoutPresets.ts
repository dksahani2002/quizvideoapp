/** Named layout packs for quick client presets (density + suggested header). */
export const LAYOUT_PRESETS = [
  { id: 'compact', label: 'Compact — more on screen', density: 0.88, headerHint: '' as string },
  { id: 'balanced', label: 'Balanced — default', density: 1, headerHint: '' },
  { id: 'large', label: 'Large type — readability', density: 1.12, headerHint: '' },
  { id: 'brand', label: 'Branded bar', density: 1, headerHint: 'YOUR BRAND' },
] as const;

export type LayoutPresetId = (typeof LAYOUT_PRESETS)[number]['id'];
