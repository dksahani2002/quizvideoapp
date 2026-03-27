// interface MCQ {
//   id: number;
//   question: string;
//   options: string[];
//   answer: number;
// }

// interface PromptItem {
//   file: string;
//   content: string;
// }

// export function buildImagePrompts(mcqs: MCQ[]): PromptItem[] {
//   return mcqs.flatMap((mcq, index) => {
//     const questionPrompt = `
// Create a vertical 9:16 YouTube Shorts image for a JavaScript quiz.

// Q${index + 1}. ${mcq.question}

// Options:
// A) ${mcq.options[0]}
// B) ${mcq.options[1]}
// C) ${mcq.options[2]}
// D) ${mcq.options[3]}

// Do NOT reveal the answer.
// Resolution: 1080x1920
// `;

//     const answerPrompt = `
// Create a vertical 9:16 YouTube Shorts image revealing the correct answer.

// Correct Answer: ${String.fromCharCode(65 + mcq.answer)}
// ${mcq.options[mcq.answer]}

// Resolution: 1080x1920
// `;

//     return [
//       { file: `q${index + 1}-question.txt`, content: questionPrompt },
//       { file: `q${index + 1}-answer.txt`, content: answerPrompt },
//     ];
//   });
// }
