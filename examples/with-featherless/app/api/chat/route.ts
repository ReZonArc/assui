import { createOpenAI } from "@ai-sdk/openai";
import {
  streamText,
  UIMessage,
  convertToModelMessages,
  tool,
  stepCountIs,
} from "ai";
import { z } from "zod";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// Initialize Featherless using OpenAI-compatible API
const featherless = createOpenAI({
  apiKey: process.env["FEATHERLESS_API_KEY"] || "",
  baseURL: process.env["FEATHERLESS_BASE_URL"] || "https://api.featherless.ai/v1",
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: featherless("gpt-3.5-turbo"), // Using a common model name, adjust based on Featherless offerings
    messages: convertToModelMessages(messages),
    stopWhen: stepCountIs(10),
    tools: {
      get_current_weather: tool({
        name: "",
        description: "Get the current weather",
        inputSchema: z.object({
          city: z.string(),
        }),
        execute: async ({ city }) => {
          return `The weather in ${city} is sunny`;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
