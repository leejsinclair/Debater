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

export interface DebateTurn {
  state: DebateState;
  participantId: string;
  participantName: string;
  content: string;
  timestamp: number;
}

export interface FrameworkConfig {
  enableFiveWhys: boolean;
  enableSteelManning: boolean;
  enableSocraticInterlude: boolean;
  enableToulminStructure: boolean;
  synthesisRound: number;
}

export interface DebateSession {
  id: string;
  config: {
    question: string;
    participants: {
      id: string;
      displayName: string;
      browserProvider: 'chatgpt' | 'gemini';
    }[];
    maxRounds: number;
    frameworks: FrameworkConfig;
    outputFormat: 'stream' | 'batch';
  };
  state: DebateState;
  history: DebateTurn[];
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

export interface AuthStatus {
  authenticated: boolean;
}
