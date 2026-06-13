import type { Quiz } from '../../common/types/index.js';
import type { MCQ } from '../agents/mcqAgent.js';
import type { GenerateRequestPayload } from './types.js';

function quizFromManual(mcq: MCQ): Quiz {
  return {
    question: mcq.question,
    options: (Array.isArray(mcq.options) ? mcq.options : Object.values(mcq.options || {})) as [
      string,
      string,
      string,
      string,
    ],
    answerIndex: mcq.answerIndex as 0 | 1 | 2 | 3,
    language: 'en',
  };
}

/** Normalize quizzes from stored request JSON (AI-resolved or manual). */
export function quizzesFromPayload(req: GenerateRequestPayload): Quiz[] {
  if (req.quizzes && req.quizzes.length > 0) {
    return req.quizzes.map((q) => ({
      question: q.question,
      options: q.options as [string, string, string, string],
      answerIndex: q.answerIndex as 0 | 1 | 2 | 3,
      language: q.language || 'en',
    }));
  }
  return (req.manualQuizzes || []).map(quizFromManual);
}
