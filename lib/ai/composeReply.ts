import { getClient, MODEL, ParseRequestError } from './parseRequest';
import { guardReply } from './replyGuard';

/**
 * Phrases a reply the way a person would, without ever being trusted with a
 * number.
 *
 * The facts are computed and handed over; the model only chooses words. Its
 * draft is then checked against those same facts, and anything that fails falls
 * back to the template. So the worst case for this feature is exactly the
 * wording we had before it -- never a wrong price (owner, 2026-08-29).
 */

export interface ComposeInput {
  /** What the customer said, so the reply answers THEM and not a generic ask. */
  customerMessage: string;
  /**
   * The facts, already computed. Written into the prompt verbatim and used as
   * the allowlist the draft is checked against.
   */
  facts: string;
  /** Every money figure the reply may contain. Anything else is a fabrication. */
  allowedFigures: number[];
  /** Figures the reply MUST contain — a quote that omits the price is no use. */
  requiredFigures?: number[];
  /** Used when the model fails, is slow, or writes something we reject. */
  fallback: string;
  /** Extra steer for this particular kind of reply. */
  guidance: string;
}

const SYSTEM = `You write short replies for a metal building dealer answering a
customer on Facebook Messenger. You are the dealer's assistant, not a chatbot.

Voice: plain, warm, and brief. The way someone behind the counter talks -- not
marketing copy, not a form letter. Contractions are good. No greetings, no
"Thank you for reaching out", no sign-off, no emoji.

THE FACTS YOU ARE GIVEN ARE THE ONLY FACTS YOU HAVE.
- Never state a number that is not in them. Not a price, not a size, not a
  monthly payment, not a term, not a percentage.
- Never do arithmetic. If a figure is not written in the facts, it does not go
  in the reply.
- Never promise anything not in the facts: no guarantees, no warranties, no
  approvals, no delivery dates, no discounts.
- If the customer asked something the facts do not answer, say a person will
  follow up. Do not guess.

Keep it to two or three sentences unless the facts clearly need more. Return
ONLY the reply text.`;

export async function composeReply(input: ComposeInput): Promise<string> {
  let message;
  try {
    message = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      // Wording, not reasoning -- and this sits in the customer's wait time.
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Customer said: ${input.customerMessage}\n\n` +
            `Facts:\n${input.facts}\n\n` +
            `${input.guidance}\n\n` +
            `Write the reply.`,
        },
      ],
    });
  } catch (err) {
    // A composer failure must never cost the customer their answer: they still
    // get the templated reply, which is correct, just stiffer.
    console.warn('[compose] model call failed, using template', err);
    return input.fallback;
  }

  const draft = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  const verdict = guardReply(draft, input.allowedFigures, input.requiredFigures ?? []);
  if (!verdict.ok) {
    // Loud, because a pattern of rejections is the signal that the prompt needs
    // work -- and because silently templating would hide it.
    console.warn(`[compose] draft rejected (${verdict.reason}); using template`);
    return input.fallback;
  }
  return draft;
}

export { ParseRequestError };
