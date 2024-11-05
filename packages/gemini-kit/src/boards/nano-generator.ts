/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { board, input, output } from "@breadboard-ai/build";
import { code } from "@google-labs/core-kit";
import { anyOf, object, array, partType } from "@breadboard-ai/build";

// eslint-disable-next-line no-var
declare global {
  type AICreateMonitorCallback = (status: { state: string }) => void;
  type AILanguageModelInitialPromptRole = 'system' | 'user' | 'assistant';
  type AILanguageModelInitialPrompt = {
    role: AILanguageModelInitialPromptRole;
    content: string;
  };
  type AICapabilityAvailability = 'readily' | 'no';
  var ai: {
    languageModel: {
      create: (options?: { signal?: AbortSignal, monitor?: AICreateMonitorCallback, systemPrompt?: string, initialPrompts?: AILanguageModelInitialPrompt[], topK?: number, temperature?: number }) => Promise<{ prompt: (text: string) => Promise<string> }>;
      capabilities: () => Promise<{
        available: AICapabilityAvailability;
        defaultTopK: number;
        maxTopK: number;
        defaultTemperature: number;
      }>;
    }
  };
}

const prompt = input({
  title: "Prompt",
  description: "The prompt to generate text from",
});

const systemPrompt = input({
  type: anyOf("string", object({ parts: array(partType) })),
  title: "System Prompt",
  description: "Optional system prompt for the model",
  default: "",
});

const initialPrompts = input({
  type: array(object({
    role: anyOf("system", "user", "assistant"),
    content: "string"
  })),
  title: "Initial Prompts",
  description: "Optional array of initial prompts with roles",
  default: [],
});

const topK = input({
  type: "number",
  title: "Top K",
  description: "Optional top-k parameter for text generation",
  default: 1,
});

const temperature = input({
  type: "number",
  title: "Temperature",
  description: "Optional temperature parameter for text generation",
  default: 0,
});

const monitor = input({
  type: anyOf("function", undefined),
  title: "Monitor",
  description: "Optional callback to monitor generation status",
});

const { text } = code(
  {
    $metadata: {
      title: "Call Prompt API",
      description: "Invoking the Prompt API to generate text from a prompt",
    },
    prompt,
    systemPrompt,
    initialPrompts,
    topK,
    temperature,
    monitor,
  },
  { text: "string" },
  async ({ 
    prompt, 
    systemPrompt, 
    initialPrompts, 
    topK, 
    temperature, 
    monitor 
  }: { 
    prompt: string;
    systemPrompt: string | { parts: any[] };
    initialPrompts?: AILanguageModelInitialPrompt[];
    topK?: number;
    temperature?: number;
    monitor?: AICreateMonitorCallback;
  }) => {
    const ERROR_MESSAGE =
      "Prompt API is not available. For more information, see https://developer.chrome.com/docs/ai/built-in.";

    const ai = globalThis.ai;
    if (!ai) {
      throw new Error(ERROR_MESSAGE);
    }
    const capabilities = await ai.languageModel.capabilities();
    const canAI = capabilities.available === 'readily';
    if (!canAI) {
      throw new Error(ERROR_MESSAGE);
    }
    const session = await ai.languageModel.create({
      systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : '',
      initialPrompts: initialPrompts || [],
      topK,
      temperature,
      monitor
    });
    const text = (await session.prompt(prompt)) as string;
    return { text };
  }
).outputs;

export default board({
  title: "Gemini Nano (Preview)",
  description: "Generates text with the on-device Gemini Nano model",
  metadata: {
    icon: "nano",
    help: {
      url: "https://breadboard-ai.github.io/breadboard/docs/kits/gemini/#the-nano-component",
    },
  },
  inputs: { prompt },
  outputs: {
    text: output(text, {
      title: "Text",
      description: "The generated text",
    }),
  },
});
