# Featherless AI Example

This example demonstrates how to use `@assistant-ui/react-ai-sdk` with Featherless AI through the Vercel AI SDK v5.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Set up your environment variables:

```bash
cp .env.example .env.local
```

Add your Featherless API key and base URL to `.env.local`:

```
FEATHERLESS_API_KEY=your-featherless-api-key-here
FEATHERLESS_BASE_URL=https://api.featherless.ai/v1
```

3. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the result.

## Key Features

- Uses the new AI SDK v5 with `@ai-sdk/react` and `@ai-sdk/openai` (OpenAI-compatible with Featherless)
- Integrates with `@assistant-ui/react` using the new `useChatRuntime` hook
- No RSC support (client-side only)
- Simplified integration with the `useChatRuntime` hook that wraps AI SDK v5's `useChat`
- Automatically uses `AssistantChatTransport` to pass system messages and frontend tools to the backend

## Custom Transport Configuration

By default, `useChatRuntime` uses `AssistantChatTransport` which automatically forwards system messages and frontend tools to the backend.

### Custom API URL with Forwarding

When customizing the API URL, you must explicitly use `AssistantChatTransport` to keep system/tools forwarding:

```typescript
import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";

const runtime = useChatRuntime({
  transport: new AssistantChatTransport({
    api: "/my-custom-api/chat", // Custom URL with system/tools forwarding
  }),
});
```

### Disable System/Tools Forwarding

To use the standard AI SDK transport without forwarding:

```typescript
import { DefaultChatTransport } from "ai";

const runtime = useChatRuntime({
  transport: new DefaultChatTransport(), // No system/tools forwarding
});
```

## API Route

The API route at `/api/chat` uses the new `streamText` function from AI SDK v5 to handle chat completions with Featherless AI.

### Configuration

Featherless AI is configured as an OpenAI-compatible provider using the AI SDK's `openai` provider with a custom base URL:

```typescript
import { openai } from "@ai-sdk/openai";

const featherless = openai({
  apiKey: process.env.FEATHERLESS_API_KEY,
  baseURL: process.env.FEATHERLESS_BASE_URL || "https://api.featherless.ai/v1",
});
```

### Environment Variables

- `FEATHERLESS_API_KEY`: Your Featherless API key
- `FEATHERLESS_BASE_URL`: The base URL for Featherless API (defaults to https://api.featherless.ai/v1)

### Supported Models

The example uses `gpt-3.5-turbo` as the model name. You may need to update this based on the actual models available through Featherless AI.

## Learn More

- [assistant-ui Documentation](https://docs.assistant-ui.com)
- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Featherless AI](https://featherless.ai)
