import { BrowserContext, Page } from 'playwright';

const CHATGPT_URL = 'https://chatgpt.com/';

/** Selectors, ordered most-specific to broadest, tried in sequence */
const INPUT_SELECTORS = [
  '#prompt-textarea',
  'div[contenteditable="true"][data-id]',
  'div[contenteditable="true"]',
];
const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]',
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

async function findElement(page: Page, selectors: string[]): Promise<string | null> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) return sel;
  }
  return null;
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
 * Sends a prompt to the ChatGPT web interface and returns the response text.
 * The provided BrowserContext must already be authenticated (logged in).
 */
export async function sendToChatGPT(
  ctx: BrowserContext,
  prompt: string
): Promise<string> {
  const page = await ctx.newPage();
  try {
    // Navigate to a fresh chat
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });

    // Check for login wall
    const currentUrl = page.url();
    if (currentUrl.includes('/auth') || currentUrl.includes('login')) {
      throw new Error(
        'ChatGPT: not authenticated. Run `POST /api/browser/auth/chatgpt` to log in first.'
      );
    }

    // Find and fill the input
    const inputSel = await findElement(page, INPUT_SELECTORS);
    if (!inputSel) {
      throw new Error('ChatGPT: could not locate the prompt input. The UI may have changed.');
    }

    await page.locator(inputSel).first().click();
    // Use keyboard to type (works with ProseMirror/contenteditable)
    await page.keyboard.type(prompt, { delay: 10 });

    // Submit
    const sendSel = await findElement(page, SEND_SELECTORS);
    if (!sendSel) {
      throw new Error('ChatGPT: could not locate the send button.');
    }
    await page.locator(sendSel).first().click();

    // Wait for response to finish streaming
    await waitForSendButtonReady(page);

    // Extract and return the response
    return await waitForStableResponse(page);
  } finally {
    await page.close();
  }
}
