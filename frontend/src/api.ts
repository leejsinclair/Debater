import { DebateSession, FrameworkConfig, AuthStatus, DebateHistoryResponse } from './types';

const BASE = '/api';

export async function getAuthStatus(): Promise<Record<string, AuthStatus>> {
  const res = await fetch(`${BASE}/browser/auth/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startAuth(
  provider: 'chatgpt' | 'gemini',
  timeoutMs = 300_000
): Promise<{ success: boolean; provider: string }> {
  const res = await fetch(`${BASE}/browser/auth/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeoutMs }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

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
  let done = false;
  let eventType = 'message';

  function isDebateTurn(value: unknown): value is import('./types').DebateTurn {
    if (typeof value !== 'object' || value === null) return false;
    const turn = value as Record<string, unknown>;
    return (
      typeof turn.state === 'string' &&
      typeof turn.participantId === 'string' &&
      typeof turn.participantName === 'string' &&
      typeof turn.content === 'string' &&
      typeof turn.timestamp === 'number'
    );
  }

  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (done) break;
    const value = chunk.value;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim() || 'message';
        continue;
      }
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          onTurn(null);
          return;
        }
        try {
          const parsed = JSON.parse(data) as unknown;
          if (eventType === 'error') {
            const errorMessage =
              typeof parsed === 'object' &&
              parsed !== null &&
              'error' in parsed &&
              typeof (parsed as { error?: unknown }).error === 'string'
                ? (parsed as { error: string }).error
                : 'Debate stream failed';
            throw new Error(errorMessage);
          }
          if (isDebateTurn(parsed)) {
            onTurn(parsed);
          } else if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'error' in parsed &&
            typeof (parsed as { error?: unknown }).error === 'string'
          ) {
            throw new Error((parsed as { error: string }).error);
          }
        } catch (err: unknown) {
          if (err instanceof Error) {
            throw err;
          }
          throw new Error('Debate stream parse error');
        } finally {
          eventType = 'message';
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

export async function getHistory(
  page = 1,
  pageSize = 8,
  query = ''
): Promise<DebateHistoryResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (query.trim()) {
    params.set('q', query.trim());
  }

  const res = await fetch(`${BASE}/history?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteHistory(sessionId: string): Promise<void> {
  const res = await fetch(`${BASE}/history/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
}

export async function resumeDebate(
  sessionId: string,
  onTurn: (turn: import('./types').DebateTurn | null) => void,
  signal?: AbortSignal
): Promise<void> {
  return runDebate(sessionId, onTurn, signal);
}
