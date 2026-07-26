/**
 * Model gateway for the AI analyst.
 *
 * The host platform routes across many providers; standalone we resolve a
 * "provider/model" id against the providers whose SDKs ship here. Adding one is
 * a case in the switch plus the dependency.
 *
 * No key configured → the analyst route reports unavailable. It never invents
 * an assessment.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export function model(id: string): LanguageModel {
  const slash = id.indexOf("/");
  if (slash < 0) {
    throw new Error(`Invalid model ID "${id}" — expected "provider/model".`);
  }
  const provider = id.slice(0, slash);
  const modelId = id.slice(slash + 1);

  switch (provider) {
    case "google":
      return createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId);
    case "openai":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId);
    default:
      throw new Error(
        `Unsupported provider "${provider}". Supported: google, anthropic, openai.`,
      );
  }
}
