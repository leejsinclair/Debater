import React, { useState, useCallback, useRef, useEffect } from 'react';
import { DebateSession, DebateTurn, FrameworkConfig, AuthStatus } from './types';
import { createDebate, runDebate, getAuthStatus, startAuth } from './api';

const STATE_LABELS: Record<string, string> = {
  ROUND_1_AI1: 'Round 1 — Opening (Toulmin structure)',
  ROUND_1_AI2: 'Round 1 — Counter (5 Whys + Steel-man)',
  SOCRATIC_INTERLUDE: 'Socratic Interlude — Clarifying Questions',
  ROUND_2_AI1: 'Round 2 — Defence',
  ROUND_2_AI2: 'Round 2 — Deepened Counter',
  ROUND_3_AI1: 'Round 3 — Synthesis',
  FINAL_AI1: 'Final Summary',
  FINAL_AI2: 'Final Summary',
  COMPLETE: 'Debate Complete',
};

const PARTICIPANT_COLORS: Record<string, string> = {
  chatgpt: 'bg-emerald-50 border-emerald-300',
  gemini: 'bg-blue-50 border-blue-300',
};

const DEFAULT_FRAMEWORKS: FrameworkConfig = {
  enableFiveWhys: true,
  enableSteelManning: true,
  enableSocraticInterlude: true,
  enableToulminStructure: true,
  synthesisRound: 5,
};

const PROVIDERS: { id: 'chatgpt' | 'gemini'; label: string; url: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'chatgpt.com' },
  { id: 'gemini', label: 'Gemini', url: 'gemini.google.com' },
];

function TurnCard({ turn }: { turn: DebateTurn }) {
  const colorClass = PARTICIPANT_COLORS[turn.participantId] ?? 'bg-gray-50 border-gray-200';
  const label = STATE_LABELS[turn.state] ?? turn.state;
  return (
    <div className={`rounded-lg border p-4 mb-4 ${colorClass}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm">{turn.participantName}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{turn.content}</p>
    </div>
  );
}

function FrameworkToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-indigo-600"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

type AppStatus = 'idle' | 'loading' | 'running' | 'complete' | 'error';
type AuthingProvider = 'chatgpt' | 'gemini' | null;

export default function App() {
  const [question, setQuestion] = useState('');
  const [frameworks, setFrameworks] = useState<FrameworkConfig>(DEFAULT_FRAMEWORKS);
  const [session, setSession] = useState<DebateSession | null>(null);
  const [turns, setTurns] = useState<DebateTurn[]>([]);
  const [status, setStatus] = useState<AppStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [authingProvider, setAuthingProvider] = useState<AuthingProvider>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Load auth status on mount
  useEffect(() => {
    getAuthStatus()
      .then(setAuthStatus)
      .catch(() => {});
  }, []);

  const refreshAuthStatus = useCallback(() => {
    getAuthStatus()
      .then(setAuthStatus)
      .catch(() => {});
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleAuth = useCallback(
    async (provider: 'chatgpt' | 'gemini') => {
      setAuthingProvider(provider);
      setError(null);
      try {
        await startAuth(provider);
        await refreshAuthStatus();
      } catch (err: unknown) {
        setError(String(err));
      } finally {
        setAuthingProvider(null);
      }
    },
    [refreshAuthStatus]
  );

  const handleStart = useCallback(async () => {
    if (!question.trim()) return;
    setError(null);
    setTurns([]);
    setStatus('loading');

    try {
      const newSession = await createDebate(question.trim(), frameworks, 'stream');
      setSession(newSession);
      setStatus('running');

      const ac = new AbortController();
      abortRef.current = ac;

      await runDebate(
        newSession.id,
        (turn) => {
          if (turn === null) {
            setStatus('complete');
          } else {
            setTurns((prev) => [...prev, turn]);
            setTimeout(scrollToBottom, 100);
          }
        },
        ac.signal
      );
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setError(String(err));
        setStatus('error');
      }
    }
  }, [question, frameworks, scrollToBottom]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
  }, []);

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    setSession(null);
    setTurns([]);
    setStatus('idle');
    setError(null);
  }, []);

  const updateFramework = useCallback(<K extends keyof FrameworkConfig>(
    key: K,
    value: FrameworkConfig[K]
  ) => {
    setFrameworks((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isRunning = status === 'running' || status === 'loading';
  const allAuthenticated = PROVIDERS.every((p) => authStatus[p.id]?.authenticated);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-indigo-700 text-white py-4 px-6 shadow">
        <h1 className="text-2xl font-bold tracking-tight">⚔️ Debater</h1>
        <p className="text-indigo-200 text-sm mt-1">
          Multi-round AI debate via browser automation — no API keys required
        </p>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Authentication panel */}
        <section className="bg-white rounded-xl shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-1">Browser Authentication</h2>
          <p className="text-xs text-gray-500 mb-4">
            Click <strong>Log in</strong> to open a browser window and sign in to each AI service.
            Your session is saved so you only need to do this once.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            {PROVIDERS.map((p) => {
              const auth = authStatus[p.id];
              const isAuthing = authingProvider === p.id;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between flex-1 border rounded-lg p-3"
                >
                  <div>
                    <span className="font-medium text-sm">{p.label}</span>
                    <span className="text-xs text-gray-400 ml-2">{p.url}</span>
                    <div className="text-xs mt-0.5">
                      {auth?.authenticated ? (
                        <span className="text-green-600">✓ Authenticated</span>
                      ) : (
                        <span className="text-amber-600">⚠ Not authenticated</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleAuth(p.id)}
                    disabled={isAuthing || isRunning}
                    className="ml-4 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {isAuthing ? 'Opening browser\u2026' : auth?.authenticated ? 'Re-authenticate' : 'Log in'}
                  </button>
                </div>
              );
            })}
          </div>
          {!allAuthenticated && (
            <p className="text-xs text-amber-600 mt-3">
              ⚠ Both services must be authenticated before starting a debate.
            </p>
          )}
        </section>

        {/* Question input */}
        <section className="bg-white rounded-xl shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-3">Debate Question</h2>
          <textarea
            className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            rows={3}
            placeholder="Enter the question to debate, e.g. 'Does remote work improve productivity?'"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isRunning}
          />

          {/* Frameworks */}
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Reasoning Frameworks</h3>
            <div className="grid grid-cols-2 gap-2">
              <FrameworkToggle
                label="Toulmin Structure (Round 1)"
                checked={frameworks.enableToulminStructure}
                onChange={(v) => updateFramework('enableToulminStructure', v)}
              />
              <FrameworkToggle
                label="5 Whys (Root Cause)"
                checked={frameworks.enableFiveWhys}
                onChange={(v) => updateFramework('enableFiveWhys', v)}
              />
              <FrameworkToggle
                label="Steel-Manning"
                checked={frameworks.enableSteelManning}
                onChange={(v) => updateFramework('enableSteelManning', v)}
              />
              <FrameworkToggle
                label="Socratic Interlude"
                checked={frameworks.enableSocraticInterlude}
                onChange={(v) => updateFramework('enableSocraticInterlude', v)}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleStart}
              disabled={isRunning || !question.trim() || !allAuthenticated}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {status === 'loading' ? 'Starting\u2026' : 'Start Debate'}
            </button>
            {isRunning && (
              <button
                onClick={handleStop}
                className="px-5 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition"
              >
                Stop
              </button>
            )}
            {(status === 'complete' || status === 'error') && (
              <button
                onClick={handleReset}
                className="px-5 py-2 bg-gray-500 text-white rounded-lg text-sm font-medium hover:bg-gray-600 transition"
              >
                Reset
              </button>
            )}
          </div>
        </section>

        {/* Status */}
        {status === 'running' && (
          <div className="flex items-center gap-2 text-indigo-600 mb-4 text-sm">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Debate in progress — browser windows are automated…
          </div>
        )}
        {status === 'complete' && (
          <div className="text-green-600 text-sm mb-4 font-medium">✓ Debate complete!</div>
        )}
        {session && (
          <div className="text-xs text-gray-400 mb-4">Session ID: {session.id}</div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Debate turns */}
        {turns.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Debate Transcript</h2>
            {turns.map((turn, idx) => (
              <TurnCard key={idx} turn={turn} />
            ))}
          </section>
        )}

        {/* Legend */}
        {turns.length > 0 && (
          <div className="mt-4 flex gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-emerald-200 border border-emerald-300" />
              ChatGPT
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-blue-200 border border-blue-300" />
              Gemini
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}
