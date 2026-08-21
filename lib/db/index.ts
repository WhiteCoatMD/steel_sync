// Lazy Neon client. neon() throws when DATABASE_URL is absent, and Next.js
// evaluates module top-level code at build time — so it must not run on import.
// Do NOT wrap this in a Proxy: libraries that introspect the client break.
import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _sql = neon(url);
  }
  return _sql;
}
