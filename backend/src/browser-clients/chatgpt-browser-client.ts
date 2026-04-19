import { BrowserContext, Page } from 'playwright';
import { findElement } from './browser-manager';

export const CHATGPT_URL = 'https://chatgpt.com/';

/** Selectors, ordered most-specific to broadest, tried in sequence */
export const INPUT_SELECTORS = [
  '#prompt-textarea',
  'div[contenteditable="true"][data-id]',
  'div[contenteditable="true"]',
];
export const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]',
  'button[type="submit"]',
  'button[data-testid*="send" i]',
  'button[aria-label*="Send" i]',
];
const STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label="Stop streaming"]',
];
const RESPONSE_SELECTOR = '[data-message-author-role="assistant"]';

const NAVIGATION_TIMEOUT = 60_000;
const RESPONSE_TIMEOUT = 120_000;
const POLL_INTERVAL = 1_500;
const STABLE_CHECK_REPEATS = 3;

async function enterPrompt(page: Page, inputSel: string, prompt: string): Promise<void> {
  const input = page.locator(inputSel).first();
  await input.click();
  const safePrompt = prompt.replace(/\r\n/g, '\n').trim();

  const tagName = await input.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  if (tagName === 'textarea') {
    await input.fill(safePrompt);
  } else {
    // insertText avoids firing Enter keydown events for newline characters,
    // which can otherwise submit partial prompts line-by-line.
    await page.keyboard.insertText(safePrompt);
  }

  await page.waitForFunction(
    ([selector, expectedLength]) => {
      const element = document.querySelector(selector);
      if (!element) return false;

      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        return element.value.trim().length >= expectedLength;
      }

      const text = element.textContent || '';
      return text.trim().length >= expectedLength;
    },
    [inputSel, Math.max(1, Math.min(safePrompt.length, 40))] as [string, number],
    { timeout: 10_000 }
  );
}

async function submitPrompt(page: Page): Promise<void> {
  for (const sel of SEND_SELECTORS) {
    const button = page.locator(sel).first();
    const visible = await button.isVisible({ timeout: 1_000 }).catch(() => false);
    if (!visible) continue;

    const enabled = await button.isEnabled().catch(() => false);
    if (!enabled) continue;

    await button.click();
    return;
  }

  await page.keyboard.press('Enter');
}

async function waitForSendButtonReady(page: Page): Promise<void> {
  // Wait for stop button to disappear (streaming in progress)
  for (const sel of STOP_SELECTORS) {
    try {
      await page.waitForSelector(sel, { state: 'visible', timeout: 5_000 });
      // Stop button appeared; now wait for it to disappear
      await page.waitForSelector(sel, { state: 'hidden', timeout: RESPONSE_TIMEOUT });
      return;
    } catch {
      // This stop selector did not appear — try the next one
    }
  }
  // Fallback: wait for the send button to be enabled (not disabled)
  const sendSel = await findElement(page, SEND_SELECTORS);
  if (sendSel) {
    await page.locator(sendSel).first().waitFor({ state: 'visible', timeout: RESPONSE_TIMEOUT });
    // Give a brief moment for any residual animation to settle
    await page.waitForTimeout(1_000);
  } else {
    // Last resort: fixed delay
    await page.waitForTimeout(5_000);
  }
}

async function extractLastResponse(page: Page): Promise<string> {
  const elements = page.locator(RESPONSE_SELECTOR);
  const count = await elements.count();
  if (count === 0) throw new Error('ChatGPT: no assistant response found on page');
  return (await elements.nth(count - 1).innerText()).trim();
}

async function waitForResponseToStart(page: Page, minCount = 1): Promise<void> {
  await page.waitForFunction(
    ([selector, count]: [string, number]) => document.querySelectorAll(selector).length >= count,
    [RESPONSE_SELECTOR, minCount] as [string, number],
    { timeout: RESPONSE_TIMEOUT }
  );
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
 * Sends a prompt to the ChatGPT web interface and returns the response text.
 * The provided BrowserContext must already be authenticated (logged in).
 * The browser page stays open between calls so the debate is visible live.
 */
export async function sendToChatGPT(
  ctx: BrowserContext,
  prompt: string
): Promise<string> {
  let page = persistentPages.get(ctx);

  if (!page || page.isClosed()) {
    page = await ctx.newPage();
    await page.goto(CHATGPT_URL, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });

    const currentUrl = page.url();
    if (currentUrl.includes('/auth') || currentUrl.includes('login')) {
      await page.close();
      throw new Error(
        'ChatGPT: not authenticated. Run `POST /api/browser/auth/chatgpt` to log in first.'
      );
    }

    // Wait for the prompt input to actually render (React may not have mounted yet)
    try {
      await page.waitForSelector(INPUT_SELECTORS[0], { state: 'visible', timeout: 15_000 });
    } catch {
      await page.close();
      throw new Error(
        'ChatGPT: prompt input did not appear. The session may have expired — re-authenticate via the frontend.'
      );
    }

    persistentPages.set(ctx, page);
  }

  const existingResponseCount = await page.locator(RESPONSE_SELECTOR).count();

  // Find and fill the input
  const inputSel = await findElement(page, INPUT_SELECTORS);
  if (!inputSel) {
    throw new Error('ChatGPT: could not locate the prompt input. The UI may have changed.');
  }

  await enterPrompt(page, inputSel, prompt);

  // Give the app a moment to enable the submit control after the prompt is present.
  await page.waitForTimeout(500);

  // Submit
  await submitPrompt(page);

  await waitForResponseToStart(page, existingResponseCount + 1);
  await waitForSendButtonReady(page);

  // Extract and return the response
  return await waitForStableResponse(page);
}
