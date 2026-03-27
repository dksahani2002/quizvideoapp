import { Plus, Trash2, Upload } from 'lucide-react';
import type { Quiz } from '../../types';

interface Props {
  quizzes: Quiz[];
  onChange: (quizzes: Quiz[]) => void;
}

export function ManualQuizForm({ quizzes, onChange }: Props) {
  function updateQuiz(idx: number, patch: Partial<Quiz>) {
    const updated = [...quizzes];
    updated[idx] = { ...updated[idx], ...patch };
    onChange(updated);
  }

  function updateOption(qIdx: number, oIdx: number, value: string) {
    const updated = [...quizzes];
    const opts = [...updated[qIdx].options] as [string, string, string, string];
    opts[oIdx] = value;
    updated[qIdx] = { ...updated[qIdx], options: opts };
    onChange(updated);
  }

  function addQuiz() {
    onChange([...quizzes, { question: '', options: ['', '', '', ''], answerIndex: 0 }]);
  }

  function removeQuiz(idx: number) {
    if (quizzes.length <= 1) return;
    onChange(quizzes.filter((_, i) => i !== idx));
  }

  function handleImportJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data: unknown = JSON.parse(text);
        const obj = (typeof data === 'object' && data !== null) ? (data as Record<string, unknown>) : null;
        const arr: unknown[] = Array.isArray(data)
          ? data
          : Array.isArray(obj?.mcqs)
            ? (obj!.mcqs as unknown[])
            : Array.isArray(obj?.quizzes)
              ? (obj!.quizzes as unknown[])
              : [];

        const parsed: Quiz[] = arr.map((raw) => {
          const q = (typeof raw === 'object' && raw !== null) ? (raw as Record<string, unknown>) : {};
          const question = typeof q.question === 'string' ? q.question : '';
          const rawOptions = Array.isArray(q.options) ? q.options : [];
          const options = (rawOptions.length === 4 && rawOptions.every(v => typeof v === 'string')
            ? (rawOptions as [string, string, string, string])
            : ['', '', '', ''] as [string, string, string, string]);
          const rawAnswerIndex = (q.answerIndex ?? q.answer);
          const answerIndexNum = typeof rawAnswerIndex === 'number' ? rawAnswerIndex : 0;
          const answerIndex = (answerIndexNum >= 0 && answerIndexNum <= 3 ? answerIndexNum : 0) as 0 | 1 | 2 | 3;
          return { question, options, answerIndex };
        });
        if (parsed.length > 0) onChange(parsed);
      } catch {
        alert('Failed to parse JSON file');
      }
    };
    input.click();
  }

  const labels = ['A', 'B', 'C', 'D'];

  return (
    <div className="space-y-4 mb-6">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
        <p className="font-medium text-[hsl(var(--foreground))] mb-1">Correct answer</p>
        <p>
          By default the correct option is <strong>A</strong>. Click the radio next to B, C, or D to mark a different option as correct before you generate the video.
        </p>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Questions ({quizzes.length})</h2>
        <button
          onClick={handleImportJSON}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <Upload size={14} />
          Import JSON
        </button>
      </div>

      {quizzes.map((quiz, qi) => (
        <div key={qi} className="bg-[hsl(var(--card))] rounded-xl p-5 border border-[hsl(var(--border))]">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Question {qi + 1}</label>
              <textarea
                value={quiz.question}
                onChange={e => updateQuiz(qi, { question: e.target.value })}
                placeholder="Type your question here..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/50"
              />
            </div>
            {quizzes.length > 1 && (
              <button onClick={() => removeQuiz(qi)} className="mt-5 p-1.5 rounded text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))]/10">
                <Trash2 size={16} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            {quiz.options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`answer-${qi}`}
                  checked={quiz.answerIndex === oi}
                  onChange={() => updateQuiz(qi, { answerIndex: oi as 0 | 1 | 2 | 3 })}
                  className="accent-[hsl(var(--success))]"
                />
                <span className="text-xs font-bold text-[hsl(var(--primary))] w-5">{labels[oi]})</span>
                <input
                  type="text"
                  value={opt}
                  onChange={e => updateOption(qi, oi, e.target.value)}
                  placeholder={`Option ${labels[oi]}`}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/50"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Select the radio next to the correct option (defaults to A if unchanged).
          </p>
        </div>
      ))}

      <button
        onClick={addQuiz}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]/50 transition-colors w-full justify-center"
      >
        <Plus size={16} />
        Add Question
      </button>
    </div>
  );
}
