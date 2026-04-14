export type DebateState =
  | 'IDLE'
  | 'ROUND_1_AI1'
  | 'ROUND_1_AI2'
  | 'SOCRATIC_INTERLUDE'
  | 'ROUND_2_AI1'
  | 'ROUND_2_AI2'
  | 'ROUND_3_AI1'
  | 'FINAL_AI1'
  | 'FINAL_AI2'
  | 'COMPLETE';

export interface FrameworkConfig {
  enableFiveWhys: boolean;
  enableSteelManning: boolean;
  enableSocraticInterlude: boolean;
  enableToulminStructure: boolean;
  synthesisRound: number;
}

export interface PersonaConfig {
  id: string;
  displayName: string;
  apiProvider: 'openai' | 'google' | 'anthropic';
  model: string;
  apiKey: string;
  systemPromptTemplate: string;
}

export interface DebateConfig {
  question: string;
  participants: PersonaConfig[];
  maxRounds: number;
  frameworks: FrameworkConfig;
  outputFormat: 'stream' | 'batch';
}

export interface DebateTurn {
  state: DebateState;
  participantId: string;
  participantName: string;
  content: string;
  timestamp: number;
}

export interface DebateSession {
  id: string;
  config: DebateConfig;
  state: DebateState;
  history: DebateTurn[];
  socraticQuestions?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StartDebateRequest {
  question: string;
  participants?: Partial<PersonaConfig>[];
  frameworks?: Partial<FrameworkConfig>;
  outputFormat?: 'stream' | 'batch';
}

export interface ApiError {
  error: string;
  code?: string;
}
