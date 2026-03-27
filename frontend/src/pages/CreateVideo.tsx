import { useState, useRef, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, PenLine, Loader2, CheckCircle, Volume2, Languages, Wand2 } from 'lucide-react';
import { useGenerateVideo, previewTopic } from '../api/videos';
import { previewTts } from '../api/tts';
import { ManualQuizForm } from '../components/quiz/ManualQuizForm';
import { ThemePicker } from '../components/theme/ThemePicker';
import type { Quiz, ThemeConfig, VideoThemePayload } from '../types';
import { THEME_PRESETS } from '../lib/themes';
import { LAYOUT_PRESETS, type LayoutPresetId } from '../lib/layoutPresets';
import { QUIZ_LANGUAGES, DEFAULT_QUIZ_LANGUAGE } from '../lib/languages';
import { DEFAULT_MCQ_GUIDELINES } from '../lib/mcqGuidelinesDefault';

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

  const [language, setLanguage] = useState<string>(DEFAULT_QUIZ_LANGUAGE);
  const [translateTopic, setTranslateTopic] = useState(false);
  const [enhanceTopic, setEnhanceTopic] = useState(true);
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [tone, setTone] = useState<'neutral' | 'professional' | 'friendly' | 'exam' | 'witty'>('neutral');
  const [audience, setAudience] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [mcqGuidelines, setMcqGuidelines] = useState(DEFAULT_MCQ_GUIDELINES);
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');

  const [layoutPresetId, setLayoutPresetId] = useState<LayoutPresetId>('balanced');
  const [layoutDensity, setLayoutDensity] = useState(1);
  const [headerTitle, setHeaderTitle] = useState('');
  const [introScript, setIntroScript] = useState('');
  const [outroScript, setOutroScript] = useState('');
  const [ctaLine, setCtaLine] = useState('');
  const [captionsBurnIn, setCaptionsBurnIn] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [topicActionLoading, setTopicActionLoading] = useState<null | 'translate' | 'enhance'>(null);
  const [topicActionError, setTopicActionError] = useState<string | null>(null);

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

  const quizLanguageLabel = useMemo(
    () => QUIZ_LANGUAGES.find((l) => l.code === language)?.label ?? language,
    [language]
  );

  useEffect(() => {
    if (language === 'en') {
      setTranslateTopic(false);
    } else {
      setTranslateTopic(true);
    }
  }, [language]);

  const [introThemeCustom, setIntroThemeCustom] = useState(false);
  const [introThemeLocal, setIntroThemeLocal] = useState<ThemeConfig>(() => ({
    preset: 'deep-purple',
    customStops: [],
    backgroundImage: '',
    backgroundOpacity: 1,
    textAlign: 'center',
    fontSize: 'medium',
  }));
  const [outroThemeCustom, setOutroThemeCustom] = useState(false);
  const [outroThemeLocal, setOutroThemeLocal] = useState<ThemeConfig>(() => ({
    preset: 'deep-purple',
    customStops: [],
    backgroundImage: '',
    backgroundOpacity: 1,
    textAlign: 'center',
    fontSize: 'medium',
  }));

  function syncIntroThemeFromMain() {
    const activeStops =
      theme.preset === 'custom'
        ? theme.customStops
        : THEME_PRESETS.find((p) => p.id === theme.preset)?.stops || [];
    setIntroThemeLocal({ ...theme, customStops: activeStops });
  }

  function syncOutroThemeFromMain() {
    const activeStops =
      theme.preset === 'custom'
        ? theme.customStops
        : THEME_PRESETS.find((p) => p.id === theme.preset)?.stops || [];
    setOutroThemeLocal({ ...theme, customStops: activeStops });
  }

  function themeToVideoPayload(t: ThemeConfig): VideoThemePayload {
    const activeStops =
      t.preset === 'custom'
        ? t.customStops
        : THEME_PRESETS.find((p) => p.id === t.preset)?.stops || [];
    return {
      preset: t.preset,
      customStops: activeStops,
      backgroundImage: t.backgroundImage,
      backgroundOpacity: t.backgroundOpacity,
    };
  }

  function applyLayoutPreset(id: LayoutPresetId) {
    const p = LAYOUT_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setLayoutPresetId(id);
    setLayoutDensity(p.density);
    if (p.headerHint) setHeaderTitle(p.headerHint);
  }

  async function applyTranslateToTopic() {
    if (language === 'en') return;
    const t = topic.trim();
    if (!t) {
      setTopicActionError('Enter a topic first.');
      return;
    }
    setTopicActionError(null);
    setTopicActionLoading('translate');
    try {
      const r = await previewTopic({
        topic: t,
        language,
        translateTopic: true,
        enhanceTopic: false,
        openaiModel: openaiModel.trim() || undefined,
      });
      setTopic(r.data.localizedLabel);
      setTranslateTopic(false);
    } catch (e) {
      setTopicActionError((e as Error).message);
    } finally {
      setTopicActionLoading(null);
    }
  }

  async function applyEnhanceToTopic() {
    const t = topic.trim();
    if (!t) {
      setTopicActionError('Enter a topic first.');
      return;
    }
    setTopicActionError(null);
    setTopicActionLoading('enhance');
    try {
      const r = await previewTopic({
        topic: t,
        language,
        translateTopic: translateTopic && language !== 'en',
        enhanceTopic: true,
        openaiModel: openaiModel.trim() || undefined,
      });
      setTopic(r.data.promptSubject);
      setEnhanceTopic(false);
      if (language !== 'en') setTranslateTopic(false);
    } catch (e) {
      setTopicActionError((e as Error).message);
    } finally {
      setTopicActionLoading(null);
    }
  }

  async function handlePreviewVoice() {
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const blob = await previewTts({
        language,
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
      language,
      ttsProvider,
      theme: { ...theme, customStops: activeStops },
      ...(introThemeCustom ? { introTheme: themeToVideoPayload(introThemeLocal) } : {}),
      ...(outroThemeCustom ? { outroTheme: themeToVideoPayload(outroThemeLocal) } : {}),
      textAlign: theme.textAlign,
      ...(mode === 'topic'
        ? {
            difficulty,
            tone,
            audience: audience.trim() || undefined,
            customInstructions: customInstructions.trim() || undefined,
            guidelines: mcqGuidelines.trim() || undefined,
            openaiModel: openaiModel.trim() || undefined,
            translateTopic,
            enhanceTopic,
          }
        : {}),
      layoutDensity: effectiveLayoutDensity,
      headerTitle: headerTitle.trim().slice(0, 32) || undefined,
      introScript: introScript.trim() || undefined,
      outroScript: outroScript.trim() || undefined,
      ctaLine: ctaLine.trim() || undefined,
      captionsBurnIn,
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

      {mode === 'manual' && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-[hsl(var(--foreground))] leading-relaxed"
        >
          <strong className="font-semibold">Topic &amp; AI style</strong> (translate topic, enhance topic, AI guidelines) only show in{' '}
          <strong className="font-semibold">AI-Generated (Topic)</strong> — use the first button above to switch.
        </div>
      )}

      {/* Language — manual mode only (topic mode includes language inside Topic & AI style) */}
      {mode === 'manual' && (
        <div className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))] mb-6 space-y-3">
          <h2 className="text-lg font-semibold">Language</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
            Quiz text, voice, and on-screen copy. Use the same language you type in your questions.
          </p>
          <div>
            <label htmlFor="quiz-language-manual" className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">
              Quiz &amp; voice language
            </label>
            <select
              id="quiz-language-manual"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full max-w-md px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
            >
              {QUIZ_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Topic Mode */}
      {mode === 'topic' && (
        <div className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))] mb-6 space-y-5">
          <h2 className="text-lg font-semibold">Topic &amp; AI style</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
            Choose <strong className="text-[hsl(var(--foreground))]">language</strong>, then use <strong className="text-[hsl(var(--foreground))]">Apply translate</strong> / <strong className="text-[hsl(var(--foreground))]">Apply enhance</strong> (optional), and enter your <strong className="text-[hsl(var(--foreground))]">topic</strong> in the field below.
          </p>
          <p className="text-xs rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/25 px-3 py-2 text-[hsl(var(--foreground))]">
            <span className="font-semibold">Current:</span>{' '}
            Translate{' '}
            {language === 'en' ? (
              <span className="text-[hsl(var(--muted-foreground))]">off (English)</span>
            ) : translateTopic ? (
              <span className="text-[hsl(var(--primary))]">on → {quizLanguageLabel}</span>
            ) : (
              <span className="text-[hsl(var(--muted-foreground))]">off</span>
            )}
            {' · '}
            Enhance{' '}
            {enhanceTopic ? (
              <span className="text-[hsl(var(--primary))]">on</span>
            ) : (
              <span className="text-[hsl(var(--muted-foreground))]">off</span>
            )}
          </p>

          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--input))]/40 p-4 space-y-2">
            <label htmlFor="quiz-language-topic" className="block text-sm font-medium text-[hsl(var(--foreground))]">
              1. Quiz &amp; voice language
            </label>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              Pick a non-English language to use <strong>Apply translate</strong>. English can still use <strong>Apply enhance</strong>.
            </p>
            <select
              id="quiz-language-topic"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full max-w-lg px-3 py-2.5 rounded-lg bg-[hsl(var(--background))] border-2 border-[hsl(var(--border))] text-sm font-medium"
            >
              {QUIZ_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div
            id="topic-translate-enhance"
            className="rounded-xl border-2 border-[hsl(var(--primary))]/35 bg-[hsl(var(--primary))]/8 p-4 sm:p-5 space-y-4 shadow-sm scroll-mt-24"
          >
            <div>
              <p className="text-base font-bold text-[hsl(var(--foreground))] tracking-tight">2. Translate &amp; enhance topic</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 leading-relaxed">
                Click to run the AI step and <strong className="text-[hsl(var(--foreground))]">fill the topic field below</strong>. Uses your OpenAI key from Settings. Checkboxes control whether translation / enhancement runs again on{' '}
                <strong>Generate Video</strong> (turn off after applying to avoid doing it twice).
              </p>
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3">
              <button
                type="button"
                disabled={language === 'en' || topicActionLoading !== null}
                onClick={() => void applyTranslateToTopic()}
                title={
                  language === 'en'
                    ? 'Choose a non-English language in step 1 to translate the topic.'
                    : 'Translate your English topic into the quiz language and put the result in the topic field'
                }
                className={`flex flex-1 min-w-[min(100%,220px)] items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-semibold transition-colors border-2 min-h-[48px] ${
                  language === 'en'
                    ? 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))] cursor-not-allowed'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]/60'
                }`}
              >
                {topicActionLoading === 'translate' ? (
                  <Loader2 size={20} className="shrink-0 animate-spin" />
                ) : (
                  <Languages size={20} className="shrink-0" />
                )}
                <span className="text-left leading-snug">
                  {language === 'en' ? (
                    <>Apply translate — choose language in step 1</>
                  ) : (
                    <>
                      Apply translate → <span className="whitespace-nowrap">{quizLanguageLabel}</span>
                    </>
                  )}
                </span>
              </button>
              <button
                type="button"
                disabled={topicActionLoading !== null}
                onClick={() => void applyEnhanceToTopic()}
                title="Expand the topic into a richer brief for MCQs and put it in the topic field"
                className="flex flex-1 min-w-[min(100%,220px)] items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-semibold transition-colors border-2 min-h-[48px] border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]/60"
              >
                {topicActionLoading === 'enhance' ? (
                  <Loader2 size={20} className="shrink-0 animate-spin" />
                ) : (
                  <Wand2 size={20} className="shrink-0" />
                )}
                <span>Apply enhance for questions</span>
              </button>
            </div>
            {topicActionError && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {topicActionError}
              </p>
            )}
            <div className="flex flex-col gap-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 px-3 py-3">
              <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                  checked={language !== 'en' && translateTopic}
                  disabled={language === 'en'}
                  onChange={(e) => setTranslateTopic(e.target.checked)}
                />
                <span className="text-[hsl(var(--muted-foreground))] leading-snug">
                  <span className="font-medium text-[hsl(var(--foreground))]">Translate from English</span> when generating (quiz language)
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                  checked={enhanceTopic}
                  onChange={(e) => setEnhanceTopic(e.target.checked)}
                />
                <span className="text-[hsl(var(--muted-foreground))] leading-snug">
                  <span className="font-medium text-[hsl(var(--foreground))]">Enhance topic</span> for MCQs when generating
                </span>
              </label>
            </div>
            <ul className="text-[11px] text-[hsl(var(--muted-foreground))] space-y-1.5 list-disc pl-4 marker:text-[hsl(var(--primary))]">
              <li>
                <strong className="text-[hsl(var(--foreground))]">Translate</strong>: intro title, slide text, and{' '}
                <code className="text-[10px] px-1 rounded bg-[hsl(var(--background))] border border-[hsl(var(--border))]">{'{{topic}}'}</code> in voice use the quiz language.
              </li>
              <li>
                <strong className="text-[hsl(var(--foreground))]">Enhance</strong>: extra AI step builds a richer brief for MCQs (uses your OpenAI key).
              </li>
            </ul>
          </div>

          <div>
            <label htmlFor="topic-input" className="block text-sm font-medium mb-1.5 text-[hsl(var(--foreground))]">
              3. Topic
            </label>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2">
              Type in English, or use <strong className="text-[hsl(var(--foreground))]">Apply translate</strong> / <strong className="text-[hsl(var(--foreground))]">Apply enhance</strong> above to fill this field.
            </p>
            <textarea
              id="topic-input"
              rows={3}
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. JavaScript Event Loop, Photosynthesis, World War II..."
              className="w-full px-4 py-3 rounded-lg bg-[hsl(var(--input))] border-2 border-[hsl(var(--border))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/50 focus:border-[hsl(var(--primary))]/50 resize-y min-h-20"
            />
          </div>

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
            <div className="sm:col-span-2">
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
            <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">
              Quiz generation guidelines (AI)
            </label>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2 leading-relaxed">
              These bullets are sent to the model as the &quot;Guidelines&quot; section. Edit freely; leave empty to use the built-in default on the server.
            </p>
            <textarea
              value={mcqGuidelines}
              onChange={(e) => setMcqGuidelines(e.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm resize-y min-h-[140px] font-mono text-[13px] leading-relaxed"
            />
            <button
              type="button"
              onClick={() => setMcqGuidelines(DEFAULT_MCQ_GUIDELINES)}
              className="mt-2 text-xs text-[hsl(var(--primary))] hover:underline"
            >
              Reset to default guidelines
            </button>
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
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Intro script (optional)</label>
              <input
                value={introScript}
                onChange={e => setIntroScript(e.target.value)}
                placeholder="Use {{topic}} to include the topic"
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Outro script (optional)</label>
              <input
                value={outroScript}
                onChange={e => setOutroScript(e.target.value)}
                placeholder="Use {{topic}} to include the topic"
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">CTA line (optional)</label>
              <input
                value={ctaLine}
                onChange={e => setCtaLine(e.target.value)}
                placeholder="e.g. Follow for more"
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input
                id="burnin"
                type="checkbox"
                checked={captionsBurnIn}
                onChange={(e) => setCaptionsBurnIn(e.target.checked)}
                className="accent-[hsl(var(--primary))]"
              />
              <label htmlFor="burnin" className="text-sm text-[hsl(var(--muted-foreground))]">Burn-in subtitles</label>
            </div>
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
      {showTheme && (
        <div className="space-y-6">
          <ThemePicker theme={theme} onChange={setTheme} />

          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Intro &amp; outro backgrounds</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                By default, intro and outro use the same look as the quiz. Enable below to set a different gradient or background image for each.
              </p>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 rounded border-[hsl(var(--border))]"
                  checked={introThemeCustom}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setIntroThemeCustom(on);
                    if (on) syncIntroThemeFromMain();
                  }}
                />
                <span className="text-sm">
                  <span className="font-medium">Custom intro background</span>
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                    Gradient colors and/or background image for the opening slide only.
                  </span>
                </span>
              </label>
              {introThemeCustom && (
                <div className="pl-7 border-l-2 border-[hsl(var(--border))]">
                  <button
                    type="button"
                    onClick={syncIntroThemeFromMain}
                    className="text-xs text-[hsl(var(--primary))] hover:underline mb-3"
                  >
                    Reset intro theme from main quiz theme
                  </button>
                  <ThemePicker theme={introThemeLocal} onChange={setIntroThemeLocal} />
                </div>
              )}
            </div>

            <div className="space-y-3 pt-2 border-t border-[hsl(var(--border))]">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 rounded border-[hsl(var(--border))]"
                  checked={outroThemeCustom}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setOutroThemeCustom(on);
                    if (on) syncOutroThemeFromMain();
                  }}
                />
                <span className="text-sm">
                  <span className="font-medium">Custom outro background</span>
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                    Gradient colors and/or background image for the closing slide only.
                  </span>
                </span>
              </label>
              {outroThemeCustom && (
                <div className="pl-7 border-l-2 border-[hsl(var(--border))]">
                  <button
                    type="button"
                    onClick={syncOutroThemeFromMain}
                    className="text-xs text-[hsl(var(--primary))] hover:underline mb-3"
                  >
                    Reset outro theme from main quiz theme
                  </button>
                  <ThemePicker theme={outroThemeLocal} onChange={setOutroThemeLocal} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
