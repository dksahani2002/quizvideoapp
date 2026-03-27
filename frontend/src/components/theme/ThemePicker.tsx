import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { AlignLeft, AlignCenter, AlignRight, ImagePlus, X } from 'lucide-react';
import { THEME_PRESETS } from '../../lib/themes';
import type { ThemeConfig } from '../../types';

interface Props {
  theme: ThemeConfig;
  onChange: (theme: ThemeConfig) => void;
}

export function ThemePicker({ theme, onChange }: Props) {
  const [editingStop, setEditingStop] = useState<number | null>(null);

  function selectPreset(id: string) {
    if (id === 'custom') {
      const base = THEME_PRESETS.find(p => p.id === theme.preset)?.stops || THEME_PRESETS[0].stops;
      onChange({ ...theme, preset: 'custom', customStops: [...base] });
    } else {
      onChange({ ...theme, preset: id, customStops: [] });
    }
  }

  function updateStop(idx: number, color: string) {
    const stops = [...theme.customStops];
    stops[idx] = { ...stops[idx], color };
    onChange({ ...theme, customStops: stops });
  }

  function handleImageUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        try {
          const res = await fetch('/api/uploads/background', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, filename: `bg_${Date.now()}.png` }),
          });
          const data = await res.json();
          if (data.success) {
            onChange({ ...theme, backgroundImage: data.path });
          }
        } catch { /* ignore */ }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  const activeStops = theme.preset === 'custom'
    ? theme.customStops
    : THEME_PRESETS.find(p => p.id === theme.preset)?.stops || [];

  const gradientCSS = activeStops.length >= 2
    ? `linear-gradient(180deg, ${activeStops.map(s => `${s.color} ${s.pos * 100}%`).join(', ')})`
    : '#1a1a2e';

  return (
    <div className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))] mb-6 space-y-6">
      <h2 className="text-lg font-semibold">Theme Customizer</h2>

      {/* Preset Themes */}
      <div>
        <label className="block text-sm font-medium mb-3 text-[hsl(var(--muted-foreground))]">Background Theme</label>
        <div className="grid grid-cols-4 gap-3">
          {THEME_PRESETS.map(preset => {
            const bg = `linear-gradient(180deg, ${preset.stops.map(s => `${s.color} ${s.pos * 100}%`).join(', ')})`;
            return (
              <button
                key={preset.id}
                onClick={() => selectPreset(preset.id)}
                className={`rounded-xl p-1 transition-all ${
                  theme.preset === preset.id ? 'ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--background))]' : 'hover:ring-1 hover:ring-[hsl(var(--border))]'
                }`}
              >
                <div className="h-20 rounded-lg" style={{ background: bg }} />
                <p className="text-xs mt-1.5 font-medium">{preset.name}</p>
              </button>
            );
          })}
          <button
            onClick={() => selectPreset('custom')}
            className={`rounded-xl p-1 transition-all ${
              theme.preset === 'custom' ? 'ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--background))]' : 'hover:ring-1 hover:ring-[hsl(var(--border))]'
            }`}
          >
            <div className="h-20 rounded-lg bg-gradient-to-b from-fuchsia-900 via-purple-800 to-indigo-900 flex items-center justify-center text-xs font-bold text-white/50">
              Custom
            </div>
            <p className="text-xs mt-1.5 font-medium">Custom</p>
          </button>
        </div>
      </div>

      {/* Custom Color Stops */}
      {theme.preset === 'custom' && theme.customStops.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-3 text-[hsl(var(--muted-foreground))]">Color Stops (top to bottom)</label>
          <div className="flex gap-3 mb-3">
            {theme.customStops.map((stop, i) => (
              <button
                key={i}
                onClick={() => setEditingStop(editingStop === i ? null : i)}
                className={`w-12 h-12 rounded-lg border-2 transition-all ${
                  editingStop === i ? 'border-[hsl(var(--primary))] scale-110' : 'border-[hsl(var(--border))]'
                }`}
                style={{ backgroundColor: stop.color }}
                title={`Stop ${i + 1}: ${stop.color}`}
              />
            ))}
          </div>
          {editingStop !== null && (
            <div className="flex items-start gap-4">
              <HexColorPicker
                color={theme.customStops[editingStop]?.color || '#000000'}
                onChange={(color) => updateStop(editingStop, color)}
              />
              <div className="text-sm text-[hsl(var(--muted-foreground))]">
                <p className="font-medium mb-1">Stop {editingStop + 1}</p>
                <p>Position: {Math.round(theme.customStops[editingStop].pos * 100)}%</p>
                <p>Color: {theme.customStops[editingStop].color}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Background Image Upload */}
      <div>
        <label className="block text-sm font-medium mb-3 text-[hsl(var(--muted-foreground))]">Background Image (optional)</label>
        <div className="flex gap-3 items-center">
          <button
            onClick={handleImageUpload}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--secondary))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <ImagePlus size={16} />
            Upload Image
          </button>
          {theme.backgroundImage && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[hsl(var(--success))]">Image uploaded</span>
              <button onClick={() => onChange({ ...theme, backgroundImage: '' })} className="text-[hsl(var(--destructive))]">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
        {theme.backgroundImage && (
          <div className="mt-3">
            <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Opacity: {Math.round(theme.backgroundOpacity * 100)}%</label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(theme.backgroundOpacity * 100)}
              onChange={e => onChange({ ...theme, backgroundOpacity: Number(e.target.value) / 100 })}
              className="w-48 accent-[hsl(var(--primary))]"
            />
          </div>
        )}
      </div>

      {/* Text Alignment */}
      <div>
        <label className="block text-sm font-medium mb-3 text-[hsl(var(--muted-foreground))]">Question Text Alignment</label>
        <div className="flex gap-2">
          {([
            { val: 'left' as const, icon: AlignLeft },
            { val: 'center' as const, icon: AlignCenter },
            { val: 'right' as const, icon: AlignRight },
          ]).map(({ val, icon: Icon }) => (
            <button
              key={val}
              onClick={() => onChange({ ...theme, textAlign: val })}
              className={`p-2.5 rounded-lg transition-colors ${
                theme.textAlign === val
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
              }`}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </div>

      {/* Live Preview */}
      <div>
        <label className="block text-sm font-medium mb-3 text-[hsl(var(--muted-foreground))]">Preview</label>
        <div className="w-48 aspect-[9/16] rounded-xl overflow-hidden border border-[hsl(var(--border))]" style={{ background: gradientCSS }}>
          <div className="h-full flex flex-col justify-center p-3">
            <div className="bg-black/30 rounded-lg p-2 mb-2">
              <p className={`text-[7px] font-bold text-white leading-tight ${
                theme.textAlign === 'left' ? 'text-left' : theme.textAlign === 'right' ? 'text-right' : 'text-center'
              }`}>
                Sample question text here?
              </p>
            </div>
            {['A', 'B', 'C', 'D'].map(l => (
              <div key={l} className="bg-black/20 rounded px-2 py-1 mb-1 border border-cyan-400/30">
                <p className="text-[5px] text-white/80"><span className="text-cyan-400 font-bold">{l})</span> Option text</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
