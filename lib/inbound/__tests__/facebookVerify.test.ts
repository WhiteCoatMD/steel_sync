import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyFacebookSignature,
  verifySubscription,
  extractMessages,
  getAppSecret,
} from '../facebookVerify';
import { splitForMessenger, repliesGloballyEnabled } from '../facebookSend';

/**
 * The webhook URL is public and protected only by being hard to guess. Without
 * signature verification, anyone who finds it can POST whatever they like:
 * fake customer messages that spend our model budget, or a forged sender id
 * that reads back another customer's conversation.
 */

const SECRET = 'test-app-secret';
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

const original = {
  secret: process.env.FACEBOOK_APP_SECRET,
  verify: process.env.FACEBOOK_VERIFY_TOKEN,
};
beforeEach(() => {
  process.env.FACEBOOK_APP_SECRET = SECRET;
  process.env.FACEBOOK_VERIFY_TOKEN = 'my-verify-token';
});
afterEach(() => {
  if (original.secret === undefined) delete process.env.FACEBOOK_APP_SECRET;
  else process.env.FACEBOOK_APP_SECRET = original.secret;
  if (original.verify === undefined) delete process.env.FACEBOOK_VERIFY_TOKEN;
  else process.env.FACEBOOK_VERIFY_TOKEN = original.verify;
});

describe('signature verification', () => {
  const body = JSON.stringify({ object: 'page', entry: [] });

  it('accepts a genuine signature', () => {
    expect(verifyFacebookSignature(body, sign(body))).toBe(true);
  });

  it('rejects a body that was altered after signing', () => {
    const tampered = JSON.stringify({ object: 'page', entry: [{ id: 'injected' }] });
    expect(verifyFacebookSignature(tampered, sign(body))).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyFacebookSignature(body, sign(body, 'not-our-secret'))).toBe(false);
  });

  it.each([
    ['no header', undefined],
    ['empty', ''],
    ['no algorithm', 'abcdef'],
    ['wrong algorithm', `sha1=${'a'.repeat(40)}`],
    ['empty digest', 'sha256='],
    ['not hex', 'sha256=zzzz'],
  ])('rejects %s', (_label, header) => {
    expect(verifyFacebookSignature(body, header as string | undefined)).toBe(false);
  });

  it('never throws on malformed input — a bad signature is routine, not exceptional', () => {
    expect(() => verifyFacebookSignature('', null)).not.toThrow();
    expect(() => verifyFacebookSignature(body, 'sha256=' + 'f'.repeat(63))).not.toThrow();
  });

  it('refuses to run without a configured secret rather than defaulting', () => {
    // A fallback secret would make every forged request valid.
    delete process.env.FACEBOOK_APP_SECRET;
    expect(() => getAppSecret()).toThrow(/FACEBOOK_APP_SECRET/);
  });

  it('is sensitive to the exact bytes, which is why the RAW body must be used', () => {
    // Re-serialising a parsed object reorders keys and drops whitespace, so a
    // handler that verifies JSON.stringify(await req.json()) fails every time.
    const raw = '{"object":"page",  "entry":[]}';
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(verifyFacebookSignature(raw, sign(raw))).toBe(true);
    expect(verifyFacebookSignature(reserialised, sign(raw))).toBe(false);
  });
});

describe('the subscription handshake', () => {
  const params = (o: Record<string, string>) => new URLSearchParams(o);

  it('echoes the challenge when the token matches', () => {
    expect(
      verifySubscription(
        params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'my-verify-token', 'hub.challenge': '12345' }),
      ),
    ).toBe('12345');
  });

  it('refuses a wrong token', () => {
    expect(
      verifySubscription(
        params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guessed', 'hub.challenge': '12345' }),
      ),
    ).toBeNull();
  });

  it('refuses when no verify token is configured', () => {
    // Otherwise anyone who guesses the URL could point their own Meta app at us.
    delete process.env.FACEBOOK_VERIFY_TOKEN;
    expect(
      verifySubscription(
        params({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }),
      ),
    ).toBeNull();
  });

  it.each([
    ['wrong mode', { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'my-verify-token', 'hub.challenge': '1' }],
    ['no challenge', { 'hub.mode': 'subscribe', 'hub.verify_token': 'my-verify-token' }],
    ['nothing at all', {}],
  ])('refuses %s', (_label, o) => {
    expect(verifySubscription(params(o as Record<string, string>))).toBeNull();
  });
});

describe('pulling messages out of the envelope', () => {
  const wrap = (messaging: unknown[]) => ({
    object: 'page',
    entry: [{ id: 'PAGE_1', messaging }],
  });

  it('extracts a normal customer message', () => {
    const out = extractMessages(
      wrap([{ sender: { id: 'USER_1' }, recipient: { id: 'PAGE_1' }, message: { mid: 'm1', text: 'how much for a 24x30?' } }]),
    );
    expect(out).toEqual([
      { senderId: 'USER_1', pageId: 'PAGE_1', text: 'how much for a 24x30?', messageId: 'm1' },
    ]);
  });

  it('SKIPS our own replies, which would otherwise make the bot answer itself', () => {
    // An echo is a message the PAGE sent. Treating one as customer input is an
    // infinite loop billed to us.
    const out = extractMessages(
      wrap([{ sender: { id: 'PAGE_1' }, recipient: { id: 'USER_1' }, message: { text: '24x30: $9,235', is_echo: true } }]),
    );
    expect(out).toEqual([]);
  });

  it('skips the traffic that is not a text message', () => {
    const out = extractMessages(
      wrap([
        { sender: { id: 'U' }, delivery: { mids: ['m1'] } },
        { sender: { id: 'U' }, read: { watermark: 1 } },
        { sender: { id: 'U' }, reaction: { emoji: '👍' } },
        { sender: { id: 'U' }, message: { attachments: [{ type: 'image' }] } },
        { sender: { id: 'U' }, message: { text: '   ' } },
      ]),
    );
    expect(out).toEqual([]);
  });

  it('handles several messages in one delivery', () => {
    const out = extractMessages(
      wrap([
        { sender: { id: 'A' }, recipient: { id: 'PAGE_1' }, message: { text: 'first' } },
        { sender: { id: 'B' }, recipient: { id: 'PAGE_1' }, message: { text: 'second' } },
      ]),
    );
    expect(out.map(m => m.senderId)).toEqual(['A', 'B']);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['the wrong object type', { object: 'instagram', entry: [] }],
    ['no entry array', { object: 'page' }],
    ['entry without messaging', { object: 'page', entry: [{ id: 'P' }] }],
  ])('returns nothing for %s instead of throwing', (_label, payload) => {
    // A webhook that throws gets retried by Meta forever.
    expect(() => extractMessages(payload)).not.toThrow();
    expect(extractMessages(payload)).toEqual([]);
  });

  it('requires a sender id, since it keys the conversation', () => {
    const out = extractMessages(wrap([{ recipient: { id: 'PAGE_1' }, message: { text: 'hi' } }]));
    expect(out).toEqual([]);
  });
});

describe('splitting a long reply for Messenger', () => {
  it('leaves a short message alone', () => {
    expect(splitForMessenger('24x30: $9,235')).toEqual(['24x30: $9,235']);
  });

  it('splits on paragraph boundaries, not mid-number', () => {
    const quote = `24' x 30' x 10' garage: $9,235.\n\n${'detail line. '.repeat(200)}`;
    const parts = splitForMessenger(quote);
    expect(parts.length).toBeGreaterThan(1);
    // The price must survive intact in the first part rather than being cut.
    expect(parts[0]).toContain('$9,235');
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1900);
  });

  it('hard-splits a single oversized block rather than dropping it', () => {
    const parts = splitForMessenger('x'.repeat(5000));
    expect(parts.join('').length).toBe(5000);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1900);
  });

  it('loses no content', () => {
    const text = ['alpha', 'beta', 'gamma'].map(w => w.repeat(400)).join('\n\n');
    expect(splitForMessenger(text).join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });
});

describe('the global mute switch', () => {
  afterEach(() => { delete process.env.FACEBOOK_AUTO_REPLY; });

  it('defaults to ENABLED, because per-dealer auto_reply is the real gate', () => {
    // A new dealer starts with auto_reply=false, so nothing speaks until the
    // dealer is switched on. Making this default off too would mean every
    // dealer needs a deploy before they can ever answer.
    expect(repliesGloballyEnabled()).toBe(true);
  });

  it('mutes the whole platform for exactly "off"', () => {
    process.env.FACEBOOK_AUTO_REPLY = 'off';
    expect(repliesGloballyEnabled()).toBe(false);
    process.env.FACEBOOK_AUTO_REPLY = ' OFF ';
    expect(repliesGloballyEnabled()).toBe(false);
  });

  it.each(['on', 'true', 'yes', '1', ''])('stays enabled for %s', v => {
    process.env.FACEBOOK_AUTO_REPLY = v;
    expect(repliesGloballyEnabled()).toBe(true);
  });
});
