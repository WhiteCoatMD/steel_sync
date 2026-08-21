import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tagged-template `sql` the module gets from getSql(). Records the SQL text
// and returns whatever rows the test queues up. Never touches a database.
let rows: unknown[] = [];
const sqlCalls: string[] = [];
const sql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
  sqlCalls.push(strings.join('?'));
  return Promise.resolve(rows);
});

vi.mock('../index', () => ({ getSql: () => sql }));

const { markNotifyFailed } = await import('../quotes');

describe('markNotifyFailed', () => {
  beforeEach(() => {
    rows = [];
    sqlCalls.length = 0;
    sql.mockClear();
  });

  it('uses RETURNING so the affected row count is observable', async () => {
    rows = [{ id: 'qt_1' }];
    await markNotifyFailed('qt_1');
    expect(sqlCalls[0]).toMatch(/RETURNING/i);
  });

  it('stays quiet when a row was actually updated', async () => {
    rows = [{ id: 'qt_1' }];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await markNotifyFailed('qt_1');

    expect(errSpy).not.toHaveBeenCalled();
  });

  // An UPDATE matching nothing succeeds silently in Postgres. Without this
  // check a wrong id leaves the quote at status = 'new' and logs nothing, so
  // an undelivered lead is also an unflagged one.
  it('logs an error when the UPDATE matched no row', async () => {
    rows = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await markNotifyFailed('qt_does_not_exist');

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toContain('qt_does_not_exist');
  });
});
