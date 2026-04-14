export interface Message {
  role: 'user' | 'model';
  parts: { text: string }[];
}

async function geminiRequest(
  apiKey: string,
  model: string,
  systemInstruction: string,
  contents: Message[]
): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1500,
    },
  };
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function callGemini(
  apiKey: string,
  model: string,
  systemInstruction: string,
  contents: Message[]
): Promise<string> {
  const res = await geminiRequest(apiKey, model, systemInstruction, contents);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }
  const data = (await res.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return data.candidates[0]?.content?.parts?.[0]?.text ?? '';
}
