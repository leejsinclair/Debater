import { DebateSession, FrameworkConfig } from './types';

const BASE = '/api';

export async function createDebate(
  question: string,
  frameworks?: Partial<FrameworkConfig>,
  outputFormat: 'stream' | 'batch' = 'stream'
): Promise<DebateSession> {
  const res = await fetch(`${BASE}/debates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, frameworks, outputFormat }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runDebate(
  sessionId: string,
  onTurn: (turn: import('./types').DebateTurn | null) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE}/debates/${sessionId}/run`, {
    method: 'POST',
    signal,
  });
  if (!res.ok) throw new Error(await res.text());

  const reader = res.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          onTurn(null);
          return;
        }
        try {
          onTurn(JSON.parse(data));
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}

export async function getDebate(sessionId: string): Promise<DebateSession> {
  const res = await fetch(`${BASE}/debates/${sessionId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
