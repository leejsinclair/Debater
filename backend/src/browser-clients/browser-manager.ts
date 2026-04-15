import { chromium, Browser, BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';

let sharedBrowser: Browser | null = null;

/**
 * Returns the singleton Playwright Chromium browser, launching it if needed.
 * headless defaults to false so the user can observe automation and handle any
 * CAPTCHA / bot-detection challenges.
 */
export async function getBrowser(headless = false): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
  }
  return sharedBrowser;
}

/**
 * Creates a new browser context, optionally restoring saved auth cookies.
 */
export async function createContext(
  headless = false,
  authStatePath?: string
): Promise<BrowserContext> {
  const browser = await getBrowser(headless);

  const storageState =
    authStatePath && fs.existsSync(authStatePath)
      ? (authStatePath as string)
      : undefined;

  return browser.newContext({
    storageState,
    viewport: { width: 1280, height: 900 },
    userAgent:
      process.env.BROWSER_USER_AGENT ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
}

/**
 * Saves browser context cookies/storage so they can be reused on next launch.
 */
export async function saveContextState(
  ctx: BrowserContext,
  authStatePath: string
): Promise<void> {
  const dir = path.dirname(authStatePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await ctx.storageState({ path: authStatePath });
}

/**
 * Iterates over a list of CSS selectors and returns the first one whose element
 * is visible on the page, or `null` if none match within the given timeout.
 */
export async function findElement(
  page: import('playwright').Page,
  selectors: string[],
  visibilityTimeout = 2_000
): Promise<string | null> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: visibilityTimeout }).catch(() => false)) return sel;
  }
  return null;
}

/**
 * Closes the shared browser instance.
 */
export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
