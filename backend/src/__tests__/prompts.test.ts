import { formatHistory } from '../prompts';
import { DebateTurn } from '../types';

const mockHistory: DebateTurn[] = [
  {
    state: 'ROUND_1_AI1',
    participantId: 'chatgpt',
    participantName: 'ChatGPT',
    content: 'Remote work improves productivity.',
    timestamp: 1000,
  },
  {
    state: 'ROUND_1_AI2',
    participantId: 'gemini',
    participantName: 'Gemini',
    content: 'The data does not support this.',
    timestamp: 2000,
  },
];

describe('formatHistory', () => {
  it('returns empty string for empty history', () => {
    expect(formatHistory([])).toBe('');
  });

  it('formats history turns with labels', () => {
    const result = formatHistory(mockHistory);
    expect(result).toContain('[ChatGPT, ROUND_1_AI1]');
    expect(result).toContain('[Gemini, ROUND_1_AI2]');
    expect(result).toContain('Remote work improves productivity.');
    expect(result).toContain('The data does not support this.');
  });
});
