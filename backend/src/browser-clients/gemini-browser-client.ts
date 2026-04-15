import { BrowserContext, Page } from 'playwright';

const GEMINI_URL = 'https://gemini.google.com/';

const INPUT_SELECTORS = [
  'div.ql-editor[contenteditable="true"]',
  'rich-textarea .ql-editor',
  'div[contenteditable="true"][data-placeholder]',
  'textarea[aria-label]',
];
const SEND_SELECTORS = [
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

async function findElement(page: Page, selectors: string[]): Promise<string | null> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) return sel;
  }
  return null;
}

async function typeIntoEditor(page: Page, inputSel: string, text: string): Promise<void> {
  const input = page.locator(inputSel).first();
  await input.click();
  // Gemini uses Quill editor (contenteditable); keyboard.type works reliably
  await page.keyboard.type(text, { delay: 10 });
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

async function waitForResponseToStart(page: Page): Promise<void> {
  // Wait for at least one response element to appear
  for (const sel of RESPONSE_SELECTORS) {
    try {
      await page.waitForSelector(sel, { state: 'visible', timeout: RESPONSE_TIMEOUT });
      return;
    } catch {
      // try next
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
 * Sends a prompt to the Gemini web interface and returns the response text.
 * The provided BrowserContext must already be authenticated (logged in).
 */
export async function sendToGemini(
  ctx: BrowserContext,
  prompt: string
): Promise<string> {
  const page = await ctx.newPage();
  try {
    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });

    // Check for login wall
    const currentUrl = page.url();
    const parsedUrl = new URL(currentUrl);
    const hostname = parsedUrl.hostname;
    if (
      hostname === 'accounts.google.com' ||
      hostname.endsWith('.accounts.google.com') ||
      parsedUrl.pathname.includes('/signin') ||
      parsedUrl.pathname.includes('ServiceLogin')
    ) {
      throw new Error(
        'Gemini: not authenticated. Run `POST /api/browser/auth/gemini` to log in first.'
      );
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

    // Wait for the response to appear and stabilise
    await waitForResponseToStart(page);
    return await waitForStableResponse(page);
  } finally {
    await page.close();
  }
}
