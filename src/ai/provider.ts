/**
 * Zabron — Optional AI service abstraction.
 *
 * Providers can be swapped by setting AI_PROVIDER + AI_API_KEY.
 * Zabron's core functionality does NOT depend on AI.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  provider: string;
  model: string;
}

export interface AIProvider {
  name: string;
  chat(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

export class NullAIProvider implements AIProvider {
  name = 'null';
  async chat(): Promise<ChatCompletionResult> {
    return { content: '', provider: 'null', model: 'none' };
  }
}

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  constructor(private apiKey: string, private model: string, private baseUrl = 'https://api.openai.com/v1') {}
  async chat(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 512,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);
    const data: any = await response.json();
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      provider: 'openai',
      model: this.model,
    };
  }
}

let activeProvider: AIProvider = new NullAIProvider();

export function configureAI(): AIProvider {
  const provider = process.env.AI_PROVIDER?.toLowerCase();
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL ?? 'gpt-4o-mini';
  const base = process.env.AI_BASE_URL;
  if (!provider || !key) {
    activeProvider = new NullAIProvider();
    return activeProvider;
  }
  if (provider === 'openai') {
    activeProvider = new OpenAIProvider(key, model, base);
  } else {
    activeProvider = new NullAIProvider();
  }
  return activeProvider;
}

export function getAI(): AIProvider {
  return activeProvider;
}