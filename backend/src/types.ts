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
  /** Which web chat interface to automate */
  browserProvider: 'chatgpt' | 'gemini';
  /** Path to a Playwright storageState JSON for pre-authenticated sessions */
  authStatePath?: string;
  /** Run browser in headless mode (default: false) */
  headless?: boolean;
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

export interface DebateHistorySummary {
  id: string;
  question: string;
  state: DebateState;
  lastParticipantName: string | null;
  lastResponseSnippet: string;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DebateHistoryResponse {
  items: DebateHistorySummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
