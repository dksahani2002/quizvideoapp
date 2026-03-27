/**
 * MCQ Generation Service
 * Responsible for generating multiple choice questions using LLM
 */

import fetch from "node-fetch";

export interface MCQ {
  question: string;
  options: string[];
  answerIndex: number;
}

/**
 * Extract JSON from AI response (handles markdown formatting)
 */
function extractJson(text: string): string {
  if (!text || typeof text !== "string") {
    throw new Error("AI response is empty or not a string");
  }

  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");

  if (start === -1 || end === -1) {
    throw new Error("No JSON array found in AI response");
  }

  return cleaned.slice(start, end + 1);
}

/**
 * Validate MCQ schema
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

/**
 * Generate MCQs for a given topic
 */
export async function generateMCQs(
  topic: string,
  openaiUrl: string,
  openaiApiKey: string,
  count: number = 5
): Promise<MCQ[]> {
  const prompt = `
Generate ${count} high-quality multiple choice quiz questions on the topic "${topic}".

Guidelines:
- Questions should test understanding, not definitions only
- Each option must be descriptive and meaningful (not single words)
- Only ONE option should be clearly correct
- Incorrect options should be realistic and conceptually relevant
- Avoid trick questions or ambiguous wording
- Keep language simple and neutral
- Suitable for finance/learning short video content
- Do NOT repeat questions
- Do NOT mention option labels like A, B, C, D inside option text

Rules:
- Return ONLY valid JSON
- No markdown
- No explanation
- No backticks
- No trailing commas

JSON Format:
[
  {
    "question": "Clear, concise question text",
    "options": [
      "Descriptive option text explaining a concept or outcome",
      "Descriptive option text explaining a concept or outcome",
      "Descriptive option text explaining a concept or outcome",
      "Descriptive option text explaining a concept or outcome"
    ],
    "answerIndex": 0
  }
]
`;

  try {
    const response = await fetch(openaiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const aiText = data?.choices?.[0]?.message?.content || data?.output_text || "";

    if (!aiText) {
      throw new Error("Empty response from AI");
    }

    const jsonString = extractJson(aiText);
    const mcqs: MCQ[] = JSON.parse(jsonString);

    validateMCQs(mcqs);

    return mcqs;
  } catch (error) {
    throw new Error(`Failed to generate MCQs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Type `MCQ` exported via declaration above
