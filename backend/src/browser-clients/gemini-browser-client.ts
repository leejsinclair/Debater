import { BrowserContext, Page } from 'playwright';
import { findElement } from './browser-manager';

export const GEMINI_URL = 'https://gemini.google.com/';

export const INPUT_SELECTORS = [
  'div.ql-editor[contenteditable="true"]',
  'rich-textarea .ql-editor',
  'div[contenteditable="true"][data-placeholder]',
  'textarea[aria-label]',
];
export const SEND_SELECTORS = [
  'button[aria-label="Send message"]',
  'button.send-button',
  'button[data-mat-icon-name="send"]',
  'button[jsname="kj2kHd"]',
];
const RESPONSE_SELECTORS = [
  'model-response .response-content',
  '.response-container-content',
  'message-content .markdown',
  'p.response-text',
];

const NAVIGATION_TIMEOUT = 60_000;
const RESPONSE_TIMEOUT = 120_000;
const POLL_INTERVAL = 1_500;
const STABLE_CHECK_REPEATS = 3;

async function typeIntoEditor(page: Page, inputSel: string, text: string): Promise<void> {
  const input = page.locator(inputSel).first();
  await input.click();
  const safeText = text.replace(/\r\n/g, '\n').trim();
  // insertText avoids Enter keydown events for embedded newlines,
  // preventing accidental multi-submit of paragraph chunks.
  await page.keyboard.insertText(safeText);
}

async function extractLastResponse(page: Page): Promise<string> {
  for (const sel of RESPONSE_SELECTORS) {
    const els = page.locator(sel);
    const count = await els.count();
    if (count > 0) {
      return (await els.nth(count - 1).innerText()).trim();
    }
  }
  throw new Error('Gemini: no response found on page');
}

async function waitForResponseToStart(page: Page, minCount = 1): Promise<void> {
  // Wait until at least minCount response elements exist (handles reused pages where
  // previous responses are already visible)
  for (const sel of RESPONSE_SELECTORS) {
    try {
      await page.waitForFunction(
        ([s, n]: [string, number]) => document.querySelectorAll(s).length >= n,
        [sel, minCount] as [string, number],
        { timeout: RESPONSE_TIMEOUT }
      );
      return;
    } catch {
      // try next selector
    }
  }
  throw new Error('Gemini: timed out waiting for a response to appear.');
}

async function waitForStableResponse(page: Page): Promise<string> {
  let previous = '';
  let stableCount = 0;

  while (stableCount < STABLE_CHECK_REPEATS) {
    await page.waitForTimeout(POLL_INTERVAL);
    const current = await extractLastResponse(page).catch(() => '');
    if (current && current === previous) {
      stableCount++;
    } else {
      stableCount = 0;
      previous = current;
    }
  }
  return previous;
}

/**
 * Persistent page per BrowserContext — keeps the chat window open between turns
 * so the full conversation is visible in the browser throughout the debate.
 */
const persistentPages = new WeakMap<BrowserContext, Page>();

/**
 * Sends a prompt to the Gemini web interface and returns the response text.
 * The provided BrowserContext must already be authenticated (logged in).
 * The browser page stays open between calls so the debate is visible live.
 */
export async function sendToGemini(
  ctx: BrowserContext,
  prompt: string
): Promise<string> {
  let page = persistentPages.get(ctx);

  if (!page || page.isClosed()) {
    page = await ctx.newPage();
    await page.goto(GEMINI_URL, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });

    const currentUrl = page.url();
    const parsedUrl = new URL(currentUrl);
    const hostname = parsedUrl.hostname;
    if (
      hostname === 'accounts.google.com' ||
      hostname.endsWith('.accounts.google.com') ||
      parsedUrl.pathname.includes('/signin') ||
      parsedUrl.pathname.includes('ServiceLogin')
    ) {
      await page.close();
      throw new Error(
        'Gemini: not authenticated. Run `POST /api/browser/auth/gemini` to log in first.'
      );
    }

    // Wait for the input editor to actually render
    try {
      await page.waitForSelector(INPUT_SELECTORS[0], { state: 'visible', timeout: 15_000 });
    } catch {
      await page.close();
      throw new Error(
        'Gemini: prompt input did not appear. The session may have expired — re-authenticate via the frontend.'
      );
    }

    persistentPages.set(ctx, page);
  }

  // Count existing responses before sending so we can wait for a new one
  let existingResponseCount = 0;
  for (const sel of RESPONSE_SELECTORS) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      existingResponseCount = count;
      break;
    }
  }

  // Find input
  const inputSel = await findElement(page, INPUT_SELECTORS);
  if (!inputSel) {
    throw new Error('Gemini: could not locate the prompt input. The UI may have changed.');
  }

  await typeIntoEditor(page, inputSel, prompt);

  // Submit
  const sendSel = await findElement(page, SEND_SELECTORS);
  if (!sendSel) {
    // Fallback: press Enter to submit
    await page.keyboard.press('Enter');
  } else {
    await page.locator(sendSel).first().click();
  }

  // Wait for a new response to appear and stabilise
  await waitForResponseToStart(page, existingResponseCount + 1);
  return await waitForStableResponse(page);
}
