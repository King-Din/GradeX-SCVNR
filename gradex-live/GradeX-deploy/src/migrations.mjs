/*
 * One-off fixes to the live store, applied on the first request after a
 * deploy that carries them. Each runs once: a marker under meta/migrations/
 * records it. Table writes are conditional, so nothing anyone saved at the
 * same moment is lost.
 */

// Applied so far (in the Vercel Blob store, before the move to Upstash):
// - starting-password-2026-10-21: the shared starting password for everyone
//   still on it.
const MIGRATIONS = [];

export async function runMigrations(kv) {
  for (const migration of MIGRATIONS) {
    const marker = `meta/migrations/${migration.id}`;
    if (await kv.read(marker)) continue;
    for (let attempt = 1; ; attempt += 1) {
      const entry = await kv.read(`table/${migration.table}`);
      if (!entry) break;
      const { modified } = await kv.write(`table/${migration.table}`, migration.apply(entry.data), { etag: entry.etag });
      if (modified) break;
      if (attempt >= 10) throw new Error(`Migration ${migration.id} kept colliding with other saves`);
    }
    await kv.write(marker, { at: new Date().toISOString() }, { create: true });
    console.log(`Migration applied: ${migration.id}`);
  }
}
