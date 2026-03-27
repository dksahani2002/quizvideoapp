import fs from "fs";
import path from "path";
import { MCQ } from "./mcqAgent.js";
import { PromptItem } from "./promptAgent.js";

export function exportAssets(
  topic: string,
  mcqs: MCQ[],
  prompts: PromptItem[]
): void {
  const dir = path.join("output", topic.toLowerCase().replace(/\s+/g, "-"));

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(path.join(dir, "mcqs.json"), JSON.stringify(mcqs, null, 2));

  prompts.forEach((item) => {
    fs.writeFileSync(path.join(dir, item.file), item.content);
  });

  console.log(`Assets generated in ${dir}`);
}
