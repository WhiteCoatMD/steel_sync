// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AuthForm from '../AuthForm';

/**
 * Typed explicitly, not `vi.fn()`. An untyped mock infers the narrowest
 * possible resolved type, which fails to typecheck once a test indexes
 * `mock.calls[0][0]` or calls `mockResolvedValue` with a varying response
 * shape (success has `message`, failure has `error`) — see
 * app/api/dealer/__tests__/auth.test.ts.
 */
type FetchResponse = { ok: boolean; json: () => Promise<{ ok?: boolean; message?: string; error?: string }> };
type FetchCall = (input: string, init?: RequestInit) => Promise<FetchResponse>;
const fetchMock = vi.fn<FetchCall>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, message: 'Check your email.' }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
});

describe('AuthForm', () => {
  it('posts the signup fields and shows the result message', async () => {
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText(/business name/i), {
      target: { value: 'Bob Buildings' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bob@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/dealer/signup');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
    });
    expect(await screen.findByText('Check your email.')).toBeTruthy();
  });

  it('asks only for an email in login mode', () => {
    render(<AuthForm mode="login" />);
    expect(screen.queryByLabelText(/business name/i)).toBeNull();
    expect(screen.getByRole('button', { name: /send.*link/i })).toBeTruthy();
  });

  it('shows the server error instead of a success message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Tell us your business name' }),
    });
    render(<AuthForm mode="signup" />);
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Tell us your business name')).toBeTruthy();
  });
});
