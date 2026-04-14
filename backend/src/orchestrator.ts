import { randomUUID } from 'crypto';
import {
  DebateConfig,
  DebateSession,
  DebateState,
  DebateTurn,
  PersonaConfig,
  FrameworkConfig,
} from './types';
import { callOpenAI } from './api-clients/openai-client';
import { callGemini } from './api-clients/gemini-client';
import { buildOpenAIMessages, buildGeminiMessages } from './message-builder';

// In-memory session store
const sessions = new Map<string, DebateSession>();

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

function defaultPersonas(overrides: Partial<PersonaConfig>[]): PersonaConfig[] {
  const defaults: PersonaConfig[] = [
    {
      id: 'chatgpt',
      displayName: 'ChatGPT',
      apiProvider: 'openai',
      model: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY ?? '',
      systemPromptTemplate:
        'You are ChatGPT, an AI assistant participating in a structured intellectual debate (round: {{round}}). Be rigorous, logical, and intellectually honest.',
    },
    {
      id: 'gemini',
      displayName: 'Gemini',
      apiProvider: 'google',
      model: 'gemini-1.5-pro',
      apiKey: process.env.GEMINI_API_KEY ?? '',
      systemPromptTemplate:
        'You are Gemini, an AI assistant participating in a structured intellectual debate (round: {{round}}). Be rigorous, logical, and intellectually honest.',
    },
  ];
  return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
}

async function callAI(
  persona: PersonaConfig,
  state: DebateState,
  personas: PersonaConfig[],
  question: string,
  history: DebateTurn[],
  frameworks: FrameworkConfig
): Promise<string> {
  if (persona.apiProvider === 'openai') {
    const messages = buildOpenAIMessages(state, persona, personas, question, history, frameworks);
    return callOpenAI(persona.apiKey, persona.model, messages);
  } else if (persona.apiProvider === 'google') {
    const { systemInstruction, contents } = buildGeminiMessages(
      state,
      persona,
      personas,
      question,
      history,
      frameworks
    );
    return callGemini(persona.apiKey, persona.model, systemInstruction, contents);
  }
  throw new Error(`Unsupported API provider: ${persona.apiProvider}`);
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
  return session;
}

export function getSession(id: string): DebateSession | undefined {
  return sessions.get(id);
}

export function listSessions(): DebateSession[] {
  return Array.from(sessions.values());
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
    return session;
  }

  const activePersona = getActivePersona(nextStateValue, config.participants);
  const content = await callAI(
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

  if (onTurn) onTurn(turn);

  return session;
}

export async function runFullDebate(
  sessionId: string,
  onTurn?: (turn: DebateTurn) => void
): Promise<DebateSession> {
  let session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  while (session.state !== 'COMPLETE') {
    session = await advanceDebate(sessionId, onTurn);
    if (session.state === 'COMPLETE') break;
  }

  return session;
}
