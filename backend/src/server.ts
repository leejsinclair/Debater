import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import {
  createSession,
  deleteSession,
  getSession,
  listHistoryPage,
  listSessions,
  advanceDebate,
  DebateAbortedError,
  runFullDebate,
  shutdown,
} from './orchestrator';
import { StartDebateRequest, PersonaConfig } from './types';
import { createContext, saveContextState } from './browser-clients/browser-manager';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
// Comma-separated list of allowed origins for browser clients.
// Falls back to FRONTEND_ORIGIN when CORS_ORIGINS is not provided.
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? FRONTEND_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const AUTH_STATE_DIR = process.env.AUTH_STATE_DIR ?? path.join(process.cwd(), 'auth-states');
const AUTH_PATHS: Record<string, string> = {
  chatgpt: process.env.CHATGPT_AUTH_STATE ?? path.join(AUTH_STATE_DIR, 'chatgpt.json'),
  gemini: process.env.GEMINI_AUTH_STATE ?? path.join(AUTH_STATE_DIR, 'gemini.json'),
};
const PROVIDER_URLS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/',
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  })
);
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
    const status: Record<string, { authenticated: boolean }> = {};
    for (const [provider, authPath] of Object.entries(AUTH_PATHS)) {
      status[provider] = {
        authenticated: fs.existsSync(authPath),
      };
    }
    res.json(status);
  }
);

/**
 * Returns true when ChatGPT is authenticated. 
 * Login page has #prompt-textarea too (fallback), so we must check the URL is NOT a login page,
 * AND that we can find authenticated-only elements like conversation history or the nav menu.
 */
async function isChatGPTAuthenticated(page: import('playwright').Page): Promise<boolean> {
  try {
    const url = page.url();
    
    // Reject if on OAuth redirect or login pages
    if (/auth\.openai\.com|\/login|\/signin|\/auth-callback/i.test(url)) {
      return false;
    }
    
    // Must be on the main chat page
    if (!url.includes('chatgpt.com/c/') && !url.includes('chatgpt.com/')) {
      return false;
    }

    // The header login button is a reliable signal that the user is not signed in.
    const loginButton = page.locator('button[data-testid="login-button"]').first();
    if (await loginButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      console.log('[Auth] ChatGPT login button still visible');
      return false;
    }
    
    // Look for authenticated UI elements that don't exist on login page.
    // Include the account icon selector observed by the user.
    const authenticatedSelectors = [
      '[id^="radix-"] div.icon-lg',
      'button[aria-label*="New chat"]',
      'button[data-testid*="user" i]',
      'div[class*="sidebar"]',
      'button[aria-label*="account"]',
      'div[class*="conversation"]',
    ];
    
    for (const sel of authenticatedSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
        console.log(`[Auth] ChatGPT authenticated indicator found: ${sel}`);
        return true;
      }
    }
    
    return false;
  } catch (e) {
    console.log(`[Auth] ChatGPT check failed: ${String(e)}`);
    return false;
  }
}

/**
 * Returns true when Gemini is authenticated (on main page with input visible, not on Google login).
 */
async function isGeminiAuthenticated(page: import('playwright').Page): Promise<boolean> {
  try {
    const url = page.url();
    // Explicitly reject Google auth pages
    if (/accounts\.google\.com|signin|ServiceLogin/i.test(url)) {
      console.log(`[Auth] Gemini on Google auth page: ${url}`);
      return false;
    }
    // Explicitly check we're on gemini.google.com/
    if (!url.includes('gemini.google.com')) {
      console.log(`[Auth] Gemini on unexpected URL: ${url}`);
      return false;
    }
    
    // Check for authenticated UI on the main Gemini page
    const selectors = [
      'div.ql-editor[contenteditable="true"]',  // Quill editor
      'textarea[aria-label*="Message"]',
      'textarea[aria-label*="message"]',
    ];
    for (const sel of selectors) {
      const isVisible = await page.locator(sel).first().isVisible({ timeout: 1_500 }).catch(() => false);
      if (isVisible) {
        console.log(`[Auth] Gemini authenticated UI detected: ${sel}`);
        return true;
      }
    }
    return false;
  } catch (e) {
    console.log(`[Auth] Gemini check failed: ${String(e)}`);
    return false;
  }
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
    const timeoutMs = (req.body as { timeoutMs?: number }).timeoutMs ?? 15 * 60_000; // 15 minutes
    const authPath = AUTH_PATHS[provider];

    let ctx: import('playwright').BrowserContext | null = null;
    let page: import('playwright').Page | null = null;

    try {
      // Always open a visible browser for auth so the user can interact
      ctx = await createContext(false, undefined);
      page = await ctx.newPage();
      
      console.log(`[Auth] Opening browser for ${provider} at ${url}...`);
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });

      console.log(
        `[Auth] ✓ Browser opened for ${provider}. ` +
          `Please log in now. Checking every 2 seconds for ${Math.round(timeoutMs / 1000)}s...`
      );

      // Give the page a moment to fully render
      await page.waitForTimeout(2_000);

      // Poll for authentication until we detect logged-in state
      const startTime = Date.now();
      let isAuthenticated = false;
      let checkCount = 0;
      while (Date.now() - startTime < timeoutMs && !page.isClosed()) {
        checkCount++;
        let checkResult = false;
        try {
          if (provider === 'chatgpt') {
            checkResult = await isChatGPTAuthenticated(page);
          } else if (provider === 'gemini') {
            checkResult = await isGeminiAuthenticated(page);
          }
        } catch (checkErr) {
          console.log(`[Auth] Check #${checkCount} error: ${String(checkErr)}`);
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        if (checkResult) {
          console.log(`[Auth] Check #${checkCount} (${elapsed}s): ${provider} authenticated = true`);
        } else if (checkCount % 5 === 0 || checkCount <= 3) {
          console.log(`[Auth] Check #${checkCount} (${elapsed}s): waiting...`);
        }

        if (checkResult) {
          isAuthenticated = true;
          console.log(`[Auth] ✓ Login detected for ${provider}! Saving session…`);
          break;
        }

        // Wait 2 seconds before checking again
        try {
          await page.waitForTimeout(2_000);
        } catch {
          // page may have closed
          break;
        }
      }

      if (page.isClosed()) {
        throw new Error(`${provider}: browser window was closed. Please try again.`);
      }

      if (!isAuthenticated) {
        throw new Error(
          `${provider}: did not detect login after ${Math.round(timeoutMs / 1000)}s. ` +
            `Please complete the login and try again.`
        );
      }

      await saveContextState(ctx!, authPath);

      res.json({ success: true, provider });
    } catch (err: unknown) {
      const errMsg = String(err);
      console.error(`[Auth] ✗ Error for ${provider}: ${errMsg}`);
      res.status(500).json({ error: errMsg });
    } finally {
      try {
        if (page && !page.isClosed()) await page.close();
      } catch {
        // Ignore cleanup errors during auth flow teardown.
      }
      try {
        if (ctx) await ctx.close();
      } catch {
        // Ignore cleanup errors during auth flow teardown.
      }
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

// List persisted debate history summaries
app.get('/api/history', (_req: Request, res: Response) => {
  const q = typeof _req.query.q === 'string' ? _req.query.q : '';
  const page = Number.parseInt(String(_req.query.page ?? '1'), 10);
  const pageSize = Number.parseInt(String(_req.query.pageSize ?? '10'), 10);
  res.json(
    listHistoryPage(q, Number.isNaN(page) ? 1 : page, Number.isNaN(pageSize) ? 10 : pageSize)
  );
});

// Delete persisted history entry by session id
app.delete('/api/history/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteSession(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.status(204).send();
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
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
    const abortController = new AbortController();
    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
      abortController.abort();
    });

    try {
      await runFullDebate(
        req.params.id,
        (turn) => {
          if (clientClosed || res.writableEnded) return;
          res.write(`data: ${JSON.stringify(turn)}\n\n`);
        },
        abortController.signal
      );
      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (err: unknown) {
      if (clientClosed || res.writableEnded) {
        return;
      }
      if (err instanceof DebateAbortedError) {
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
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
