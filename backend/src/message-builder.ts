import { PersonaConfig, DebateTurn, FrameworkConfig, DebateState } from './types';
import {
  round1OpeningPrompt,
  round1CounterPrompt,
  socraticInterludePrompt,
  round2AI1Prompt,
  round2AI2Prompt,
  round3SynthesisPrompt,
  finalSummaryPrompt,
  formatHistory,
} from './prompts';

function buildSystemContext(persona: PersonaConfig, state: DebateState): string {
  return persona.systemPromptTemplate
    .replace('{{round}}', state)
    .replace('{{displayName}}', persona.displayName);
}

function buildUserContent(
  state: DebateState,
  personas: PersonaConfig[],
  question: string,
  history: DebateTurn[],
  frameworks: FrameworkConfig
): string {
  const ai1 = personas[0];
  const ai2 = personas[1];

  switch (state) {
    case 'ROUND_1_AI1':
      return round1OpeningPrompt(ai1.displayName, question, frameworks);
    case 'ROUND_1_AI2':
      return round1CounterPrompt(ai2.displayName, question, history, frameworks);
    case 'SOCRATIC_INTERLUDE':
      return socraticInterludePrompt(ai2.displayName, history);
    case 'ROUND_2_AI1':
      return round2AI1Prompt(ai1.displayName, question, history);
    case 'ROUND_2_AI2':
      return round2AI2Prompt(ai2.displayName, question, history, frameworks);
    case 'ROUND_3_AI1':
      return round3SynthesisPrompt(ai1.displayName, ai2.displayName, question, history);
    case 'FINAL_AI1':
      return finalSummaryPrompt(ai1.displayName, question, history);
    case 'FINAL_AI2':
      return finalSummaryPrompt(ai2.displayName, question, history);
    default:
      return `The question is: "${question}"\n\n${formatHistory(history)}`;
  }
}

/**
 * Builds the single plain-text prompt that gets typed into the web chat interface.
 * The system context (persona + round) is prepended to the task content because
 * browser-based chat UIs do not support a separate system role.
 */
export function buildPrompt(
  state: DebateState,
  activePersona: PersonaConfig,
  personas: PersonaConfig[],
  question: string,
  history: DebateTurn[],
  frameworks: FrameworkConfig
): string {
  const systemContext = buildSystemContext(activePersona, state);
  const userContent = buildUserContent(state, personas, question, history, frameworks);
  return `${systemContext}\n\n${userContent}`;
}

