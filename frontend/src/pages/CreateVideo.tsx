import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, PenLine, Loader2, CheckCircle, Volume2 } from 'lucide-react';
import { useGenerateVideo } from '../api/videos';
import { previewTts } from '../api/tts';
import { ManualQuizForm } from '../components/quiz/ManualQuizForm';
import { ThemePicker } from '../components/theme/ThemePicker';
import type { Quiz, ThemeConfig } from '../types';
import { THEME_PRESETS } from '../lib/themes';
import { LAYOUT_PRESETS, type LayoutPresetId } from '../lib/layoutPresets';

export function CreateVideo() {
  const navigate = useNavigate();
  const generate = useGenerateVideo();

  const [mode, setMode] = useState<'topic' | 'manual'>('topic');
  const [topic, setTopic] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [ttsProvider, setTtsProvider] = useState<'system' | 'openai' | 'elevenlabs'>('system');
  const [manualQuizzes, setManualQuizzes] = useState<Quiz[]>([
    { question: '', options: ['', '', '', ''], answerIndex: 0 },
  ]);

  const [language, setLanguage] = useState('English');
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [tone, setTone] = useState<'neutral' | 'professional' | 'friendly' | 'exam' | 'witty'>('neutral');
  const [audience, setAudience] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');

  const [layoutPresetId, setLayoutPresetId] = useState<LayoutPresetId>('balanced');
  const [layoutDensity, setLayoutDensity] = useState(1);
  const [headerTitle, setHeaderTitle] = useState('');

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [openaiVoice, setOpenaiVoice] = useState('alloy');
  const [openaiTtsModel, setOpenaiTtsModel] = useState<'tts-1' | 'tts-1-hd'>('tts-1');
  const [systemVoice, setSystemVoice] = useState('Alex');
  const [elevenlabsModelId, setElevenlabsModelId] = useState('');

  const [theme, setTheme] = useState<ThemeConfig>({
    preset: 'deep-purple',
    customStops: [],
    backgroundImage: '',
    backgroundOpacity: 1,
    textAlign: 'center',
    fontSize: 'medium',
  });

  const [showTheme, setShowTheme] = useState(false);

  function applyLayoutPreset(id: LayoutPresetId) {
    const p = LAYOUT_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setLayoutPresetId(id);
    setLayoutDensity(p.density);
    if (p.headerHint) setHeaderTitle(p.headerHint);
  }

  async function handlePreviewVoice() {
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const blob = await previewTts({
        ttsProvider,
        ...(ttsProvider === 'openai'
          ? { ttsVoice: openaiVoice, ttsModel: openaiTtsModel }
          : {}),
        ...(ttsProvider === 'system' ? { systemVoice: systemVoice.trim() || undefined } : {}),
        ...(ttsProvider === 'elevenlabs' && elevenlabsModelId.trim()
          ? { elevenlabsModelId: elevenlabsModelId.trim() }
          : {}),
      });
      const url = URL.createObjectURL(blob);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleGenerate() {
    const activeStops = theme.preset === 'custom'
      ? theme.customStops
      : THEME_PRESETS.find(p => p.id === theme.preset)?.stops || [];

    const fontDensity = theme.fontSize === 'small' ? 0.92 : theme.fontSize === 'large' ? 1.08 : 1;
    const effectiveLayoutDensity = Math.min(1.25, Math.max(0.75, layoutDensity * fontDensity));

    generate.mutate({
      topic: mode === 'topic' ? topic : 'Quiz',
      questionCount: mode === 'topic' ? questionCount : manualQuizzes.length,
      mcqSource: mode === 'topic' ? 'openai' : 'manual',
      manualQuizzes: mode === 'manual' ? manualQuizzes : undefined,
      ttsProvider,
      theme: { ...theme, customStops: activeStops },
      textAlign: theme.textAlign,
      ...(mode === 'topic'
        ? {
            language,
            difficulty,
            tone,
            audience: audience.trim() || undefined,
            customInstructions: customInstructions.trim() || undefined,
            openaiModel: openaiModel.trim() || undefined,
          }
        : {}),
      layoutDensity: effectiveLayoutDensity,
      headerTitle: headerTitle.trim().slice(0, 32) || undefined,
      ...(ttsProvider === 'openai'
        ? { ttsVoice: openaiVoice, ttsModel: openaiTtsModel }
        : {}),
      ...(ttsProvider === 'system' ? { systemVoice: systemVoice.trim() || undefined } : {}),
      ...(ttsProvider === 'elevenlabs' && elevenlabsModelId.trim()
        ? { elevenlabsModelId: elevenlabsModelId.trim() }
        : {}),
    }, {
      onSuccess: () => setTimeout(() => navigate('/videos'), 1500),
    });
  }

  const canGenerate = mode === 'topic'
    ? topic.trim().length > 0
    : manualQuizzes.every(q => q.question.trim() && q.options.every(o => o.trim()));

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Create Video</h1>
        <p className="text-[hsl(var(--muted-foreground))]">Generate a quiz video from a topic or your own questions</p>
      </div>

      {/* Mode Switch */}
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <button
          onClick={() => setMode('topic')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'topic'
              ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
              : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <Sparkles size={16} />
          AI-Generated (Topic)
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'manual'
              ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
              : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <PenLine size={16} />
          Manual (Type Your Own)
        </button>
      </div>

      {/* Topic Mode */}
      {mode === 'topic' && (
        <div className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))] mb-6 space-y-5">
          <h2 className="text-lg font-semibold">Topic & AI style</h2>
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="e.g. JavaScript Event Loop, World History, Science Trivia..."
            className="w-full px-4 py-3 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/50"
          />
          <div>
            <label className="block text-sm font-medium mb-2 text-[hsl(var(--muted-foreground))]">
              Number of Questions: {questionCount}
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={questionCount}
              onChange={e => setQuestionCount(Number(e.target.value))}
              className="w-full accent-[hsl(var(--primary))]"
            />
            <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
              <span>1</span><span>10</span>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Question language</label>
              <input
                value={language}
                onChange={e => setLanguage(e.target.value)}
                placeholder="English, Spanish, Hindi…"
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Chat model</label>
              <input
                value={openaiModel}
                onChange={e => setOpenaiModel(e.target.value)}
                placeholder="gpt-4o-mini"
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Difficulty</label>
              <select
                value={difficulty}
                onChange={e => setDifficulty(e.target.value as typeof difficulty)}
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Tone</label>
              <select
                value={tone}
                onChange={e => setTone(e.target.value as typeof tone)}
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              >
                <option value="neutral">Neutral</option>
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="exam">Exam-style</option>
                <option value="witty">Witty</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Audience (optional)</label>
            <input
              value={audience}
              onChange={e => setAudience(e.target.value)}
              placeholder="e.g. CFA candidates, middle school, dev bootcamp students"
              className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Extra instructions for the AI (optional)</label>
            <textarea
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              rows={3}
              placeholder="E.g. prefer numerical examples, avoid jargon, focus on misconceptions…"
              className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm resize-y min-h-[80px]"
            />
          </div>
        </div>
      )}

      {/* Manual Mode */}
      {mode === 'manual' && (
        <ManualQuizForm quizzes={manualQuizzes} onChange={setManualQuizzes} />
      )}

      {/* TTS Provider */}
      <div className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))] mb-6 space-y-4">
        <h2 className="text-lg font-semibold">Voice (TTS)</h2>
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'system' as const, label: 'System (Free)' },
            { key: 'openai' as const, label: 'OpenAI' },
            { key: 'elevenlabs' as const, label: 'ElevenLabs' },
          ]).map(p => (
            <button
              key={p.key}
              onClick={() => setTtsProvider(p.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                ttsProvider === p.key
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {ttsProvider === 'openai' && (
          <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-[hsl(var(--border))]">
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">OpenAI voice</label>
              <select
                value={openaiVoice}
                onChange={e => setOpenaiVoice(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              >
                {(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const).map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">TTS model</label>
              <select
                value={openaiTtsModel}
                onChange={e => setOpenaiTtsModel(e.target.value as 'tts-1' | 'tts-1-hd')}
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              >
                <option value="tts-1">tts-1 (faster)</option>
                <option value="tts-1-hd">tts-1-hd (higher quality)</option>
              </select>
            </div>
          </div>
        )}
        {ttsProvider === 'system' && (
          <div className="pt-2 border-t border-[hsl(var(--border))]">
            <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">System voice name (macOS: say -v)</label>
            <input
              value={systemVoice}
              onChange={e => setSystemVoice(e.target.value)}
              placeholder="Alex, Samantha, Daniel…"
              className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
            />
          </div>
        )}
        {ttsProvider === 'elevenlabs' && (
          <div className="space-y-2 pt-2 border-t border-[hsl(var(--border))]">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Default voice and API key come from Settings. Optionally override the model for this video:
            </p>
            <input
              value={elevenlabsModelId}
              onChange={e => setElevenlabsModelId(e.target.value)}
              placeholder="eleven_turbo_v2_5 (leave empty to use Settings)"
              className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[hsl(var(--border))]">
          <button
            type="button"
            onClick={() => void handlePreviewVoice()}
            disabled={previewLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:opacity-90 disabled:opacity-50"
          >
            {previewLoading ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
            Preview voice
          </button>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Plays a short MP3 with your current API keys and voice settings.
          </span>
        </div>
        {previewError && (
          <p className="text-sm text-[hsl(var(--destructive))]">{previewError}</p>
        )}
      </div>

      {/* Layout */}
      <div className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))] mb-6 space-y-4">
        <h2 className="text-lg font-semibold">On-screen layout</h2>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Fine-tune text size on the video. Theme “font size” still applies on top of this slider.
        </p>
        <div>
          <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Layout template</label>
          <select
            value={layoutPresetId}
            onChange={(e) => applyLayoutPreset(e.target.value as LayoutPresetId)}
            className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
          >
            {LAYOUT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2 text-[hsl(var(--muted-foreground))]">
            Layout density: {layoutDensity.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.75}
            max={1.25}
            step={0.01}
            value={layoutDensity}
            onChange={(e) => setLayoutDensity(Number(e.target.value))}
            className="w-full accent-[hsl(var(--primary))]"
          />
          <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
            <span>Smaller text</span><span>Larger text</span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Top bar title (branding)</label>
          <input
            value={headerTitle}
            onChange={e => setHeaderTitle(e.target.value)}
            placeholder="QUIZ — or your channel name"
            maxLength={32}
            className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
          />
        </div>
      </div>

      {/* Theme Customizer Toggle */}
      <button
        onClick={() => setShowTheme(!showTheme)}
        className="text-sm text-[hsl(var(--primary))] hover:underline mb-4 block"
      >
        {showTheme ? 'Hide' : 'Show'} Theme Customizer
      </button>
      {showTheme && <ThemePicker theme={theme} onChange={setTheme} />}

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate || generate.isPending || generate.isSuccess}
        className="mt-6 flex items-center gap-2 px-8 py-3 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold text-base hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {generate.isPending ? (
          <><Loader2 size={20} className="animate-spin" /> Generating...</>
        ) : generate.isSuccess ? (
          <><CheckCircle size={20} /> Video Queued! Redirecting...</>
        ) : (
          <><Sparkles size={20} /> Generate Video</>
        )}
      </button>
      {generate.isError && (
        <p className="mt-3 text-sm text-[hsl(var(--destructive))]">{(generate.error as Error).message}</p>
      )}
    </div>
  );
}
