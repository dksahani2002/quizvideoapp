import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { quizLanguageDisplayName } from "../utils/quizLanguages.js";
import { DEFAULT_MCQ_GUIDELINES } from "../constants/mcqGuidelinesDefault.js";

export interface MCQ {
  question: string;
  options: string[];
  answerIndex: number;
}

/**
 * 1. Clean markdown + garbage from AI output
 */
function extractJson(text: string): string {
  if (!text || typeof text !== "string") {
    throw new Error("AI response is empty or not a string");
  }

  // Remove markdown code blocks
  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // Extract first JSON array
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");

  if (start === -1 || end === -1) {
    throw new Error("No JSON array found in AI response");
  }

  return cleaned.slice(start, end + 1);
}

/**
 * Load MCQs from a local JSON file (manual mode — no OpenAI needed)
 *
 * The file must contain a JSON array matching the MCQ schema:
 * [{ "question": "...", "options": ["A","B","C","D"], "answerIndex": 0 }]
 */
export function loadMCQsFromFile(filePath: string): MCQ[] {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`MCQ file not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  const mcqs: MCQ[] = JSON.parse(raw);

  validateMCQs(mcqs);
  console.log(`✅ Loaded and validated ${mcqs.length} MCQs from ${resolved}`);

  return mcqs;
}

/**
 * 2. Validate MCQ schema
 */
function validateMCQs(mcqs: MCQ[]): void {
  if (!Array.isArray(mcqs)) {
    throw new Error("MCQs is not an array");
  }

  mcqs.forEach((mcq, index) => {
    if (typeof mcq.question !== "string") {
      throw new Error(`MCQ ${index}: question missing or invalid`);
    }

    if (!Array.isArray(mcq.options) || mcq.options.length < 2) {
      throw new Error(`MCQ ${index}: options invalid`);
    }

    if (
      typeof mcq.answerIndex !== "number" ||
      mcq.answerIndex < 0 ||
      mcq.answerIndex >= mcq.options.length
    ) {
      throw new Error(`MCQ ${index}: answerIndex invalid`);
    }
  });
}

/** Options for AI quiz generation (API route passes apiKey/apiUrl; CLI can rely on env). */
export interface MCQGenerationOptions {
  apiKey?: string;
  apiUrl?: string;
  language?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  tone?: "neutral" | "professional" | "friendly" | "exam" | "witty";
  audience?: string;
  customInstructions?: string;
  /** Replaces the default Guidelines: bullet list when non-empty (topic mode). */
  guidelines?: string;
  /** Chat model id (e.g. gpt-4o-mini, gpt-4o) */
  model?: string;
}

/**
 * Randomize which slot (0–3) holds the correct answer without changing option text.
 * Fixes models that always emit answerIndex: 0.
 */
export function shuffleMcqAnswerPositions(mcq: MCQ): MCQ {
  if (!Array.isArray(mcq.options) || mcq.options.length !== 4) return mcq;
  let ai = Math.floor(Number(mcq.answerIndex));
  if (Number.isNaN(ai) || ai < 0 || ai > 3) ai = 0;
  const entries = mcq.options.map((text, i) => ({ text, wasCorrect: i === ai }));
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  const newIdx = entries.findIndex((e) => e.wasCorrect);
  return {
    ...mcq,
    options: entries.map((e) => e.text),
    answerIndex: newIdx >= 0 ? newIdx : 0,
  };
}

function buildMcqPrompt(topic: string, count: number, opt: MCQGenerationOptions): string {
  const lang = quizLanguageDisplayName(opt.language?.trim());
  const diff = opt.difficulty || "intermediate";
  const tone = opt.tone || "neutral";
  const audience = opt.audience?.trim() || "general learners watching short-form video";
  const extra = opt.customInstructions?.trim();
  const guidelinesBody = (opt.guidelines?.trim() || DEFAULT_MCQ_GUIDELINES).trim();

  const extraBlock = extra
    ? `\nAdditional instructions from the creator:\n${extra}\n`
    : "";

  return `
Generate ${count} high-quality multiple choice quiz questions.

Authoritative topic focus (every question must test this subject only — do not drift to unrelated themes):
---
${topic}
---

Context:
- Output language for questions and options: ${lang}
- Difficulty level: ${diff} (calibrate depth and vocabulary accordingly)
- Tone: ${tone}
- Target audience: ${audience}
${extraBlock}
Guidelines:
${guidelinesBody}

Rules:
- Each question must be clearly answerable from general knowledge about the topic focus above; vary sub-angles (facts, application, common mistakes) but stay within scope.
- Return ONLY valid JSON
- No markdown
- No explanation
- No backticks
- No trailing commas
- For each question, "answerIndex" must be 0, 1, 2, or 3 indicating which option is correct — vary the position across questions (do not default every question to 0)

JSON Format (answerIndex shows which of the four options is correct; use different values across questions):
[
  {
    "question": "Clear, concise question text",
    "options": [
      "Descriptive option text explaining a concept or outcome",
      "Descriptive option text explaining a concept or outcome",
      "Descriptive option text explaining a concept or outcome",
      "Descriptive option text explaining a concept or outcome"
    ],
    "answerIndex": 2
  }
]
`;
}

/**
 * 3. Generate MCQs
 */
export async function generateMCQs(
  topic: string,
  count: number = 5,
  options: MCQGenerationOptions = {}
): Promise<MCQ[]> {
  console.log("🤖 Generating MCQs...");

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const apiUrl = (options.apiUrl ?? process.env.OPENAI_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.model?.trim() || "gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OpenAI API key required for AI quiz generation");
  }

  const prompt = buildMcqPrompt(topic, count, options);

  const url = `${apiUrl}/chat/completions`;
  const response = await fetch(url as string, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    }),
  });

  const data = await response.json() as any;

  const aiText =
    data?.choices?.[0]?.message?.content ||
    data?.output_text ||
    "";

  if (!aiText) {
    throw new Error("Empty response from AI");
  }

  const jsonString = extractJson(aiText);
  const mcqs: MCQ[] = JSON.parse(jsonString);

  validateMCQs(mcqs);
  const shuffled = mcqs.map(shuffleMcqAnswerPositions);
  console.log(`✅ Generated and validated ${shuffled.length} MCQs (correct options randomized)`);

  return shuffled;
}
