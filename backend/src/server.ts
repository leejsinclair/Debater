import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import {
  createSession,
  getSession,
  listSessions,
  advanceDebate,
  runFullDebate,
  shutdown,
} from './orchestrator';
import { StartDebateRequest, PersonaConfig } from './types';
import { createContext, saveContextState } from './browser-clients/browser-manager';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

const AUTH_STATE_DIR = process.env.AUTH_STATE_DIR ?? path.join(process.cwd(), 'auth-states');
const AUTH_PATHS: Record<string, string> = {
  chatgpt: process.env.CHATGPT_AUTH_STATE ?? path.join(AUTH_STATE_DIR, 'chatgpt.json'),
  gemini: process.env.GEMINI_AUTH_STATE ?? path.join(AUTH_STATE_DIR, 'gemini.json'),
};
const PROVIDER_URLS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/',
};

app.use(cors());
app.use(express.json());

/** Simple in-memory rate limiter: max requests per window per IP. */
function rateLimit(maxRequests: number, windowMs: number) {
  const counts = new Map<string, { count: number; resetAt: number }>();
  return (_req: Request, res: Response, next: NextFunction): void => {
    const ip = _req.ip ?? 'unknown';
    const now = Date.now();
    const entry = counts.get(ip);
    if (!entry || entry.resetAt < now) {
      counts.set(ip, { count: 1, resetAt: now + windowMs });
      next();
    } else if (entry.count < maxRequests) {
      entry.count++;
      next();
    } else {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
  };
}

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth status — reports whether saved auth state files exist for each provider
// Rate-limited: 30 requests per minute per IP (status checks are cheap but include fs.existsSync)
app.get(
  '/api/browser/auth/status',
  rateLimit(30, 60_000),
  (_req: Request, res: Response) => {
    const status: Record<string, { authenticated: boolean; path: string }> = {};
    for (const [provider, authPath] of Object.entries(AUTH_PATHS)) {
      status[provider] = {
        authenticated: fs.existsSync(authPath),
        path: authPath,
      };
    }
    res.json(status);
  }
);

/**
 * Returns true when the given URL is no longer on an auth/login page.
 * Uses hostname matching to avoid substring-in-subdomain false positives.
 */
function isPostLoginUrl(u: URL): boolean {
  const hostname = u.hostname;
  const isGoogleAuth =
    hostname === 'accounts.google.com' || hostname.endsWith('.accounts.google.com');
  const isLoginPath =
    u.pathname.includes('/login') ||
    u.pathname.includes('/signin') ||
    u.pathname.includes('/auth');
  return !isGoogleAuth && !isLoginPath;
}

/**
 * Opens a visible browser window so the user can log in manually.
 * After the user completes login, the session cookies are saved to disk.
 * The request body should contain: { timeoutMs?: number } (default 5 min).
 */
// Rate-limited: 5 auth attempts per 10 minutes per IP (each opens a browser window)
app.post(
  '/api/browser/auth/:provider',
  rateLimit(5, 10 * 60_000),
  async (req: Request, res: Response) => {
    const { provider } = req.params;
    const url = PROVIDER_URLS[provider];
    if (!url) {
      res.status(400).json({ error: `Unknown provider: ${provider}` });
      return;
    }
    const timeoutMs = (req.body as { timeoutMs?: number }).timeoutMs ?? 300_000;
    const authPath = AUTH_PATHS[provider];

    try {
      // Always open a visible browser for auth so the user can interact
      const ctx = await createContext(false, undefined);
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      console.log(
        `[Auth] Browser opened for ${provider}. ` +
          `Please log in within ${Math.round(timeoutMs / 1000)}s. ` +
          `Waiting for navigation away from the login page…`
      );

      // Wait for the user to land on the main app page (no longer on a login/auth URL)
      await page.waitForURL((u) => isPostLoginUrl(new URL(u.toString())), {
        timeout: timeoutMs,
      });

      await saveContextState(ctx, authPath);
      await ctx.close();

      res.json({ success: true, provider, savedTo: authPath });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  }
);

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

const server = app.listen(PORT, () => {
  console.log(`Debater backend running on http://localhost:${PORT}`);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down…`);
  server.close(async () => {
    await shutdown();
    process.exit(0);
  });
}
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

export default app;

