/**
 * OpenAI MCQ Generation Service
 * Implements MCQ generation using OpenAI API
 */

import { Quiz, CorrectAnswer } from '../../domain/entities/Quiz.js';
import { IMCQGenerationService } from '../../domain/services/IMCQGenerationService.js';

export interface MCQGenerationConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
}

export class OpenAIMCQGenerationService implements IMCQGenerationService {
  constructor(private config: MCQGenerationConfig) {}

  async generateMCQs(topic: string, questionCount: number): Promise<Quiz[]> {
    const prompt = this.buildPrompt(topic, questionCount);

    try {
      const apiUrl = `${this.config.apiUrl}/chat/completions`;
      console.log(`📍 Using API URL: ${apiUrl}`);
      console.log(`🔑 API Key (first 20 chars): ${this.config.apiKey.substring(0, 20)}...`);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from API');
      }

      return this.parseQuizzes(content, topic);
    } catch (error) {
      console.error('MCQ generation error:', error);
      throw error;
    }
  }

  private buildPrompt(topic: string, count: number): string {
    return `Generate exactly ${count} multiple-choice questions about "${topic}".

Return ONLY valid JSON in this exact format:
[
  {
    "question": "Question text?",
    "options": {
      "a": "Option A",
      "b": "Option B",
      "c": "Option C",
      "d": "Option D"
    },
    "correctAnswer": "a"
  }
]

Requirements:
- All options must be non-empty strings
- correctAnswer must be one of: a, b, c, d
- Questions must be clear and related to "${topic}"
- Return ONLY the JSON array, no other text`;
  }

  private parseQuizzes(content: string, topic: string): Quiz[] {
    try {
      // Extract JSON from the response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      const data = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(data)) {
        throw new Error('Response is not an array');
      }

      return data
        .map((item: any, index: number) => {
          try {
            const id = `${topic}_q${index + 1}`;
            const options = item.options || {};

            return new Quiz(
              id,
              item.question,
              {
                a: options.a || '',
                b: options.b || '',
                c: options.c || '',
                d: options.d || '',
              },
              (item.correctAnswer || 'a') as CorrectAnswer,
              'en'
            );
          } catch (error) {
            console.warn(`Failed to parse quiz ${index}:`, error);
            return null;
          }
        })
        .filter((q): q is Quiz => q !== null);
    } catch (error) {
      console.error('Failed to parse quizzes:', error);
      throw error;
    }
  }
}
