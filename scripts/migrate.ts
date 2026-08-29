import { readFileSync } from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = neon(url);
  const ddl = readFileSync(path.join(process.cwd(), 'lib/db/schema.sql'), 'utf8');
  // Neon's HTTP driver runs one statement per call; split on the statement break.
  // NOTE: this is a naive split on ';' — it is adequate for the current schema.sql
  // (plain CREATE TABLE / CREATE INDEX statements) but will break on any statement
  // that contains a semicolon inside a string literal or a function/trigger body
  // (e.g. `CREATE FUNCTION ... AS $$ ... ; ... $$`). If you add one of those, replace
  // this with a real SQL statement splitter instead of extending this split.
  // Strip `-- ...` line comments BEFORE splitting. The split below is naive, so
  // a semicolon inside a comment ends the statement early and the remainder of
  // the sentence is then executed as SQL — which is exactly what happened, with
  // a comment reading "...secretBox.ts); the column holds ciphertext" producing
  // `syntax error at or near "the"`. Comments carry no meaning here, so the
  // cheapest fix is to remove them rather than write a real parser.
  const withoutComments = ddl.replace(/--[^\r\n]*/g, '');

  for (const stmt of withoutComments.split(';').map(s => s.trim()).filter(Boolean)) {
    await sql.query(stmt);
  }
  console.log('migration complete');
}

main().catch(e => { console.error(e); process.exit(1); });
