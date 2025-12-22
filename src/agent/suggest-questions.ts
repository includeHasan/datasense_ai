import { z } from "zod";
import { getChatModel, type LlmOverrides } from "./llm.js";
import { buildSuggestQuestionsPrompt } from "./prompts.js";
import type { SchemaProfile } from "../sources/types.js";

const suggestQuestionsOutputSchema = z.object({
  questions: z.array(z.string()).min(5).max(10),
});

/**
 * Generates up to 10 example questions a business user could ask a newly
 * connected data source, based purely on its schema profile (no question
 * asked yet). Used to give users an idea of what to ask and how to phrase it.
 */
export async function suggestQuestions(
  profile: SchemaProfile,
  llm?: LlmOverrides,
): Promise<string[]> {
  const model = getChatModel(llm).withStructuredOutput(suggestQuestionsOutputSchema);
  const prompt = buildSuggestQuestionsPrompt(profile);
  const result = await model.invoke(prompt);
  return result.questions.slice(0, 10);
}
