import OpenAI from 'openai';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function callOpenAI(
  apiKey: string,
  model: string,
  messages: Message[]
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1500,
  });
  return response.choices[0]?.message?.content ?? '';
}

export async function* streamOpenAI(
  apiKey: string,
  model: string,
  messages: Message[]
): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey });
  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1500,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
