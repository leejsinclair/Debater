import { DebateTurn, FrameworkConfig } from './types';

export function formatHistory(history: DebateTurn[]): string {
  if (history.length === 0) return '';
  return history
    .map((t) => `[${t.participantName}, ${t.state}]:\n${t.content}`)
    .join('\n\n---\n\n');
}

export function round1OpeningPrompt(
  displayName: string,
  question: string,
  frameworks: FrameworkConfig
): string {
  const toulmin = frameworks.enableToulminStructure
    ? `\nStructure your response using the Toulmin model:\n- Claim: Your position in one sentence.\n- Data: Evidence that supports the claim.\n- Warrant: Why the data supports the claim.\n- Backing: The broader principle that legitimises your warrant.\n- Qualifier: Conditions under which your claim holds.\n- Rebuttal: The strongest objection you anticipate.\n`
    : '';

  return `You are ${displayName}. You are opening a structured intellectual debate.

The question is: "${question}"
${toulmin}
Be rigorous. 3–5 paragraphs.`;
}

export function round1CounterPrompt(
  displayName: string,
  question: string,
  history: DebateTurn[],
  frameworks: FrameworkConfig
): string {
  const fiveWhys = frameworks.enableFiveWhys
    ? `\nBefore countering, apply the 5 Whys to your opponent's argument: identify their central claim, then ask "why does this hold?" five times recursively until you reach a foundational assumption. Attack that assumption, not the surface claim.\n`
    : '';
  const steelMan = frameworks.enableSteelManning
    ? `\nAlso steel-man their position first: state the strongest version of their argument before you refute it.\n`
    : '';

  return `You are ${displayName}. Your role is to argue the OPPOSITE position to what has been stated.

The question is: "${question}"
${fiveWhys}${steelMan}
Debate history:
${formatHistory(history)}

Your response:`;
}

export function socraticInterludePrompt(
  ai2Name: string,
  history: DebateTurn[]
): string {
  return `Before you respond to ${ai2Name}'s counter-argument, answer these clarifying questions about your own position:

1. How are you defining the key terms in your argument? Would a different definition change your argument?
2. Does your claim hold under the conditions your opponent raised?
3. Is the warrant connecting your data to your claim valid in all cases your opponent mentioned?

Answer each question briefly, then proceed with your defence.

Debate history so far:
${formatHistory(history)}`;
}

export function round2AI1Prompt(
  displayName: string,
  question: string,
  history: DebateTurn[]
): string {
  return `You are ${displayName}. You have answered the Socratic questions. Now defend your original position.

The question is: "${question}"

Debate history:
${formatHistory(history)}

Rebut the antithesis; acknowledge what was valid in your opponent's argument. Your response:`;
}

export function round2AI2Prompt(
  displayName: string,
  question: string,
  history: DebateTurn[],
  frameworks: FrameworkConfig
): string {
  const steelMan = frameworks.enableSteelManning
    ? `\nSteel-man your opponent's defence first before deepening your counter.\n`
    : '';

  return `You are ${displayName}. Sharpen your counter-argument based on your opponent's defence. Avoid simple repetition of your prior arguments.
${steelMan}
The question is: "${question}"

Debate history:
${formatHistory(history)}

Your deepened counter-argument:`;
}

export function round3SynthesisPrompt(
  displayName: string,
  ai2Name: string,
  question: string,
  history: DebateTurn[]
): string {
  return `You are ${displayName}. This is the synthesis round. Do not repeat your prior arguments.

Instead: identify the precise point of genuine disagreement between your position and ${ai2Name}'s. What do you both agree on? What single factual or philosophical difference explains the remaining divergence?

Propose a more precise framing of the question that captures the real debate. 2–3 paragraphs only.

The question was: "${question}"

Debate history:
${formatHistory(history)}

Your synthesis:`;
}

export function finalSummaryPrompt(
  displayName: string,
  question: string,
  history: DebateTurn[]
): string {
  return `You are ${displayName}. The debate is now complete. Write your final position summary:

1. Your core claim, refined by the debate.
2. What you believe the debate demonstrated.
3. The single strongest point made by your opponent that you could not fully refute.
4. What question remains open.

Do not re-argue. Summarise and close.

The question was: "${question}"

Debate history:
${formatHistory(history)}`;
}
