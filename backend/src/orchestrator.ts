import { randomUUID } from 'crypto';
import { BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';
import {
  DebateConfig,
  DebateHistoryResponse,
  DebateHistorySummary,
  DebateSession,
  DebateState,
  DebateTurn,
  PersonaConfig,
  FrameworkConfig,
} from './types';
import { createContext, closeBrowser } from './browser-clients/browser-manager';
import { sendToChatGPT } from './browser-clients/chatgpt-browser-client';
import { sendToGemini } from './browser-clients/gemini-browser-client';
import { buildPrompt } from './message-builder';

// In-memory session store
const sessions = new Map<string, DebateSession>();

const PERSISTENCE_ENABLED =
  process.env.DISABLE_SESSION_PERSISTENCE !== 'true' && process.env.NODE_ENV !== 'test';
const SESSION_STORAGE_DIR =
  process.env.DEBATE_STORAGE_DIR ?? path.join(process.cwd(), 'data', 'conversations');

// Browser contexts keyed by sessionId → participantId → BrowserContext
const sessionContexts = new Map<string, Map<string, BrowserContext>>();

const STATE_SEQUENCE: DebateState[] = [
  'ROUND_1_AI1',
  'ROUND_1_AI2',
  'SOCRATIC_INTERLUDE',
  'ROUND_2_AI1',
  'ROUND_2_AI2',
  'ROUND_3_AI1',
  'FINAL_AI1',
  'FINAL_AI2',
  'COMPLETE',
];

function ensureStorageDir(): void {
  if (!PERSISTENCE_ENABLED) return;
  fs.mkdirSync(SESSION_STORAGE_DIR, { recursive: true });
}

function sessionFilePath(id: string): string {
  return path.join(SESSION_STORAGE_DIR, `${id}.json`);
}

function persistSession(session: DebateSession): void {
  if (!PERSISTENCE_ENABLED) return;
  ensureStorageDir();
  fs.writeFileSync(sessionFilePath(session.id), JSON.stringify(session, null, 2), 'utf-8');
}

function hydrateSessionsFromDisk(): void {
  if (!PERSISTENCE_ENABLED) return;
  ensureStorageDir();
  const files = fs.readdirSync(SESSION_STORAGE_DIR).filter((file) => file.endsWith('.json'));
  for (const fileName of files) {
    try {
      const raw = fs.readFileSync(path.join(SESSION_STORAGE_DIR, fileName), 'utf-8');
      const session = JSON.parse(raw) as DebateSession;
      if (session?.id) {
        sessions.set(session.id, session);
      }
    } catch {
      // Ignore malformed files so a single bad file doesn't break startup.
    }
  }
}

function nextState(current: DebateState, socraticEnabled: boolean): DebateState {
  if (current === 'IDLE') return 'ROUND_1_AI1';
  const idx = STATE_SEQUENCE.indexOf(current);
  if (idx === -1 || idx === STATE_SEQUENCE.length - 1) return 'COMPLETE';
  let next = STATE_SEQUENCE[idx + 1];
  if (next === 'SOCRATIC_INTERLUDE' && !socraticEnabled) {
    next = STATE_SEQUENCE[idx + 2];
  }
  return next;
}

function getActivePersona(state: DebateState, participants: PersonaConfig[]): PersonaConfig {
  const ai2States: DebateState[] = ['ROUND_1_AI2', 'ROUND_2_AI2', 'FINAL_AI2'];
  return ai2States.includes(state) ? participants[1] : participants[0];
}

function defaultFrameworks(): FrameworkConfig {
  return {
    enableFiveWhys: true,
    enableSteelManning: true,
    enableSocraticInterlude: true,
    enableToulminStructure: true,
    synthesisRound: 5,
  };
}

hydrateSessionsFromDisk();

function defaultPersonas(overrides: Partial<PersonaConfig>[]): PersonaConfig[] {
  const defaults: PersonaConfig[] = [
    {
      id: 'chatgpt',
      displayName: 'ChatGPT',
      browserProvider: 'chatgpt',
      authStatePath: process.env.CHATGPT_AUTH_STATE ?? './auth-states/chatgpt.json',
      headless: process.env.BROWSER_HEADLESS === 'true',
      systemPromptTemplate:
        'You are ChatGPT, an AI assistant participating in a structured intellectual debate (round: {{round}}). Be rigorous, logical, and intellectually honest.',
    },
    {
      id: 'gemini',
      displayName: 'Gemini',
      browserProvider: 'gemini',
      authStatePath: process.env.GEMINI_AUTH_STATE ?? './auth-states/gemini.json',
      headless: process.env.BROWSER_HEADLESS === 'true',
      systemPromptTemplate:
        'You are Gemini, an AI assistant participating in a structured intellectual debate (round: {{round}}). Be rigorous, logical, and intellectually honest.',
    },
  ];
  return defaults.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
}

/** Returns the cached BrowserContext for a participant, creating it on first use. */
async function getOrCreateContext(
  sessionId: string,
  persona: PersonaConfig
): Promise<BrowserContext> {
  if (!sessionContexts.has(sessionId)) {
    sessionContexts.set(sessionId, new Map());
  }
  const ctxMap = sessionContexts.get(sessionId)!;
  if (!ctxMap.has(persona.id)) {
    const ctx = await createContext(persona.headless ?? false, persona.authStatePath);
    ctxMap.set(persona.id, ctx);
  }
  return ctxMap.get(persona.id)!;
}

/** Closes and removes all browser contexts for a session. */
async function cleanupContexts(sessionId: string): Promise<void> {
  const ctxMap = sessionContexts.get(sessionId);
  if (ctxMap) {
    await Promise.all(Array.from(ctxMap.values()).map((ctx) => ctx.close().catch(() => {})));
    sessionContexts.delete(sessionId);
  }
}

async function callAI(
  sessionId: string,
  persona: PersonaConfig,
  state: DebateState,
  personas: PersonaConfig[],
  question: string,
  history: DebateTurn[],
  frameworks: FrameworkConfig
): Promise<string> {
  const prompt = buildPrompt(state, persona, personas, question, history, frameworks);
  const ctx = await getOrCreateContext(sessionId, persona);

  if (persona.browserProvider === 'chatgpt') {
    return sendToChatGPT(ctx, prompt);
  } else if (persona.browserProvider === 'gemini') {
    return sendToGemini(ctx, prompt);
  }
  throw new Error(`Unsupported browser provider: ${persona.browserProvider}`);
}

export function createSession(
  question: string,
  participantOverrides: Partial<PersonaConfig>[] = [],
  frameworkOverrides: Partial<FrameworkConfig> = {},
  outputFormat: 'stream' | 'batch' = 'batch'
): DebateSession {
  const id = randomUUID();
  const participants = defaultPersonas(participantOverrides);
  const frameworks = { ...defaultFrameworks(), ...frameworkOverrides };
  const config: DebateConfig = {
    question,
    participants,
    maxRounds: 5,
    frameworks,
    outputFormat,
  };
  const session: DebateSession = {
    id,
    config,
    state: 'IDLE',
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(id, session);
  persistSession(session);
  return session;
}

export function getSession(id: string): DebateSession | undefined {
  return sessions.get(id);
}

export async function deleteSession(id: string): Promise<boolean> {
  const existed = sessions.delete(id);
  await cleanupContexts(id);

  if (PERSISTENCE_ENABLED) {
    const filePath = sessionFilePath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  return existed;
}

export function listSessions(): DebateSession[] {
  return Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function buildSummary(session: DebateSession): DebateHistorySummary {
  const lastTurn = session.history.length > 0 ? session.history[session.history.length - 1] : undefined;
  const compact = (lastTurn?.content ?? '').replace(/\s+/g, ' ').trim();
  const maxSnippetLength = 180;
  const lastResponseSnippet =
    compact.length > maxSnippetLength ? `${compact.slice(0, maxSnippetLength - 1)}…` : compact;

  return {
    id: session.id,
    question: session.config.question,
    state: session.state,
    lastParticipantName: lastTurn?.participantName ?? null,
    lastResponseSnippet,
    turnCount: session.history.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function listHistorySummaries(): DebateHistorySummary[] {
  return listSessions().map(buildSummary);
}

export function listHistoryPage(
  query = '',
  page = 1,
  pageSize = 10
): DebateHistoryResponse {
  const normalizedQuery = query.trim().toLowerCase();
  const source = listHistorySummaries();
  const filtered =
    normalizedQuery.length === 0
      ? source
      : source.filter((item) => {
          const haystack = [item.question, item.lastParticipantName ?? '', item.lastResponseSnippet]
            .join(' ')
            .toLowerCase();
          return haystack.includes(normalizedQuery);
        });

  const safePageSize = Math.max(1, Math.min(pageSize, 50));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * safePageSize;

  return {
    items: filtered.slice(start, start + safePageSize),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}

export async function advanceDebate(
  sessionId: string,
  onTurn?: (turn: DebateTurn) => void
): Promise<DebateSession> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.state === 'COMPLETE') return session;

  const { config } = session;
  const nextStateValue = nextState(session.state, config.frameworks.enableSocraticInterlude);

  if (nextStateValue === 'COMPLETE') {
    session.state = 'COMPLETE';
    session.updatedAt = Date.now();
    persistSession(session);
    await cleanupContexts(sessionId);
    return session;
  }

  const activePersona = getActivePersona(nextStateValue, config.participants);
  const content = await callAI(
    sessionId,
    activePersona,
    nextStateValue,
    config.participants,
    config.question,
    session.history,
    config.frameworks
  );

  const turn: DebateTurn = {
    state: nextStateValue,
    participantId: activePersona.id,
    participantName: activePersona.displayName,
    content,
    timestamp: Date.now(),
  };

  session.history.push(turn);
  session.state = nextStateValue;
  session.updatedAt = Date.now();
  persistSession(session);

  if (onTurn) onTurn(turn);

  return session;
}

export async function runFullDebate(
  sessionId: string,
  onTurn?: (turn: DebateTurn) => void
): Promise<DebateSession> {
  let session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  try {
    while (session.state !== 'COMPLETE') {
      session = await advanceDebate(sessionId, onTurn);
      if (session.state === 'COMPLETE') break;
    }
  } finally {
    // Ensure contexts are cleaned up even on error
    await cleanupContexts(sessionId);
  }

  return session;
}

/** Shuts down the shared browser. Call on process exit. */
export async function shutdown(): Promise<void> {
  await closeBrowser();
}

