import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  createSession,
  getSession,
  listSessions,
  advanceDebate,
  runFullDebate,
} from './orchestrator';
import { StartDebateRequest, PersonaConfig } from './types';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create a new debate session
app.post('/api/debates', (req: Request, res: Response) => {
  const body = req.body as StartDebateRequest;
  if (!body.question || body.question.trim() === '') {
    res.status(400).json({ error: 'question is required' });
    return;
  }
  try {
    const session = createSession(
      body.question.trim(),
      (body.participants ?? []) as Partial<PersonaConfig>[],
      body.frameworks ?? {},
      body.outputFormat ?? 'batch'
    );
    res.status(201).json(session);
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// List all sessions
app.get('/api/debates', (_req: Request, res: Response) => {
  res.json(listSessions());
});

// Get a session
app.get('/api/debates/:id', (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

// Advance debate one step
app.post('/api/debates/:id/advance', async (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  try {
    const updated = await advanceDebate(req.params.id);
    res.json(updated);
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Run full debate with SSE streaming
app.post('/api/debates/:id/run', async (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.config.outputFormat === 'stream') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      await runFullDebate(req.params.id, (turn) => {
        res.write(`data: ${JSON.stringify(turn)}\n\n`);
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: unknown) {
      res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
      res.end();
    }
  } else {
    try {
      const final = await runFullDebate(req.params.id);
      res.json(final);
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Debater backend running on http://localhost:${PORT}`);
});

export default app;
