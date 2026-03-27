import fetch from 'node-fetch';
import { quizLanguageDisplayName } from './quizLanguages.js';

export interface TopicPrepOptions {
  apiKey: string;
  apiUrl: string;
  model?: string;
  topicInput: string;
  languageCode: string;
  /** Translate from English (or polish) into the quiz language for titles + questions */
  translateTopic: boolean;
  /** Expand scope so MCQs are more specific and high-quality */
  enhanceTopic: boolean;
}

export interface TopicPrepResult {
  /** Short phrase for intro slide, TTS {{topic}}, video list */
  localizedLabel: string;
  /** Rich subject passed into MCQ generation */
  promptSubject: string;
}

function extractJsonObject(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('AI response is empty');
  }
  let cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  return cleaned.slice(start, end + 1);
}

/**
 * One lightweight OpenAI call: translate topic to quiz language and/or expand for better MCQs.
 */
export async function prepareTopicForQuizGeneration(opts: TopicPrepOptions): Promise<TopicPrepResult> {
  const raw = opts.topicInput.trim();
  if (!raw) {
    return { localizedLabel: 'Quiz', promptSubject: 'Quiz' };
  }

  const lang = opts.languageCode.trim().toLowerCase().split('-')[0] || 'en';
  const effectiveTranslate = opts.translateTopic && lang !== 'en';

  if (!effectiveTranslate && !opts.enhanceTopic) {
    return { localizedLabel: raw, promptSubject: raw };
  }

  const displayName = quizLanguageDisplayName(opts.languageCode);
  const model = opts.model?.trim() || 'gpt-4o-mini';
  const base = (opts.apiUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/chat/completions`;

  const languageRules = effectiveTranslate
    ? `- Write BOTH fields entirely in ${displayName}. The creator typed the topic in English: translate and culturally adapt for ${displayName} speakers. Keep proper nouns (e.g. API names) in common form when appropriate.\n`
    : lang === 'en'
      ? `- Write BOTH fields in natural English.\n`
      : `- Write BOTH fields in ${displayName}. The creator topic is already in (or meant for) this language — do not translate from another language; polish wording only if needed.\n`;

  const enhanceRules = opts.enhanceTopic
    ? `- "promptSubject": expand into a brief for quiz authors — scope, what to test, typical misconceptions, sub-angles to cover — 2–4 sentences. Stay strictly on-topic.\n`
    : `- "promptSubject": stay close to the creator topic (minimal expansion).\n`;

  const prompt = `You prepare quiz video topics for educational Shorts.

Creator topic: "${raw.replace(/"/g, '\\"')}"
Quiz language: ${displayName} (code: ${lang})

${languageRules}
${enhanceRules}
- "localizedLabel": short title for the video intro (under ~60 characters when possible), same language as the quiz.

Return ONLY valid JSON with exactly these keys (no markdown):
{"localizedLabel":"...","promptSubject":"..."}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.35,
    }),
  });

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  const aiText = data?.choices?.[0]?.message?.content || '';
  if (!aiText) {
    throw new Error(data?.error?.message || 'Empty response from topic preparation');
  }

  const parsed = JSON.parse(extractJsonObject(aiText)) as { localizedLabel?: string; promptSubject?: string };
  const localizedLabel = String(parsed.localizedLabel || raw).trim() || raw;
  const promptSubject = String(parsed.promptSubject || localizedLabel).trim() || localizedLabel;

  return { localizedLabel, promptSubject };
}
