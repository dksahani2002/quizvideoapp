export interface ThemePreset {
  id: string;
  name: string;
  stops: Array<{ pos: number; color: string }>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'deep-purple',
    name: 'Deep Purple',
    stops: [
      { pos: 0.00, color: '#0B0A1A' },
      { pos: 0.25, color: '#1A1545' },
      { pos: 0.45, color: '#2D1B69' },
      { pos: 0.70, color: '#1E1145' },
      { pos: 1.00, color: '#0D0B1E' },
    ],
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    stops: [
      { pos: 0.00, color: '#0A1628' },
      { pos: 0.25, color: '#0D2847' },
      { pos: 0.45, color: '#134E6F' },
      { pos: 0.70, color: '#0D3B5C' },
      { pos: 1.00, color: '#071422' },
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    stops: [
      { pos: 0.00, color: '#1A0A1E' },
      { pos: 0.25, color: '#3D1234' },
      { pos: 0.45, color: '#6B1D4A' },
      { pos: 0.70, color: '#4A1838' },
      { pos: 1.00, color: '#150818' },
    ],
  },
  {
    id: 'neon',
    name: 'Neon',
    stops: [
      { pos: 0.00, color: '#0A0A14' },
      { pos: 0.25, color: '#0D1A2E' },
      { pos: 0.45, color: '#0A2F4A' },
      { pos: 0.70, color: '#0D1F35' },
      { pos: 1.00, color: '#080812' },
    ],
  },
  {
    id: 'minimal-dark',
    name: 'Minimal Dark',
    stops: [
      { pos: 0.00, color: '#111111' },
      { pos: 0.25, color: '#1A1A1A' },
      { pos: 0.45, color: '#222222' },
      { pos: 0.70, color: '#1A1A1A' },
      { pos: 1.00, color: '#0E0E0E' },
    ],
  },
  {
    id: 'forest',
    name: 'Forest',
    stops: [
      { pos: 0.00, color: '#0A1A0F' },
      { pos: 0.25, color: '#0F2E18' },
      { pos: 0.45, color: '#164525' },
      { pos: 0.70, color: '#0F3019' },
      { pos: 1.00, color: '#08140C' },
    ],
  },
];
