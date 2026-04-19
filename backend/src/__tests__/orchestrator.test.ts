import { createSession, getSession } from '../orchestrator';

describe('orchestrator', () => {
  it('creates a session with the provided question', () => {
    const session = createSession('Is remote work better than office work?');
    expect(session.id).toBeTruthy();
    expect(session.config.question).toBe('Is remote work better than office work?');
    expect(session.state).toBe('IDLE');
    expect(session.history).toHaveLength(0);
  });

  it('retrieves a session by id', () => {
    const session = createSession('Test question');
    const retrieved = getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(session.id);
  });

  it('returns undefined for unknown session id', () => {
    expect(getSession('nonexistent-id')).toBeUndefined();
  });

  it('applies default frameworks', () => {
    const session = createSession('Test');
    expect(session.config.frameworks.enableFiveWhys).toBe(true);
    expect(session.config.frameworks.enableSteelManning).toBe(true);
    expect(session.config.frameworks.enableSocraticInterlude).toBe(true);
    expect(session.config.frameworks.enableToulminStructure).toBe(true);
  });
});
