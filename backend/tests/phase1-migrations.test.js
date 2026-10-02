import test from 'node:test';
import assert from 'node:assert/strict';
import dbPool from '../src/infrastructure/database/DatabasePool.js';
import { runMigrations } from '../src/infrastructure/database/migrate.js';
import UnitOfWork from '../src/infrastructure/database/UnitOfWork.js';

test('Phase 1: Database Connectivity, Migrations and Schema Invariants', async (t) => {
  // 1. Connection check
  await t.test('Database connection pool is healthy', async () => {
    const health = await dbPool.checkHealth();
    assert.equal(health.isHealthy, true, 'Database should report healthy connection');
    assert.ok(typeof health.latencyMs === 'number', 'Latency should be a number');
  });

  // 2. Run migrations
  await t.test('Migrations run successfully and apply initial schema', async () => {
    await runMigrations();
  });

  // 3. Verify all 5 core tables exist
  await t.test('All 5 core domain tables exist in PostgreSQL', async () => {
    const client = await dbPool.getClient();
    try {
      const res = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('shows', 'seats', 'reservations', 'reservation_seats', 'idempotency_records');
      `);
      const existingTables = res.rows.map(r => r.table_name);
      assert.ok(existingTables.includes('shows'), 'shows table must exist');
      assert.ok(existingTables.includes('seats'), 'seats table must exist');
      assert.ok(existingTables.includes('reservations'), 'reservations table must exist');
      assert.ok(existingTables.includes('reservation_seats'), 'reservation_seats table must exist');
      assert.ok(existingTables.includes('idempotency_records'), 'idempotency_records table must exist');
    } finally {
      client.release();
    }
  });

  // 4. Verify unique constraint on seats(show_id, seat_number)
  await t.test('Seats table enforces unique constraint (show_id, seat_number)', async () => {
    const client = await dbPool.getClient();
    try {
      const res = await client.query(`
        SELECT conname 
        FROM pg_constraint 
        WHERE conname = 'uq_show_seat_number';
      `);
      assert.equal(res.rows.length, 1, 'uq_show_seat_number constraint must exist on seats');
    } finally {
      client.release();
    }
  });

  // 5. Verify UnitOfWork transaction rollback
  await t.test('UnitOfWork cleanly rolls back transactions on error', async () => {
    const uow = new UnitOfWork(dbPool);
    const testShowName = `rollback-test-${Date.now()}`;

    try {
      await uow.execute(async (tx) => {
        await tx.query(
          `INSERT INTO shows (name, total_seats, price_paise, per_user_limit) VALUES ($1, $2, $3, $4)`,
          [testShowName, 10, 25000, 4]
        );
        throw new Error('Simulated domain failure to trigger rollback');
      });
    } catch (err) {
      assert.equal(err.message, 'Simulated domain failure to trigger rollback');
    }

    // Verify record was NOT committed
    const verifyRes = await dbPool.query(`SELECT * FROM shows WHERE name = $1`, [testShowName]);
    assert.equal(verifyRes.rows.length, 0, 'Rolled-back record must not exist in database');
  });

  t.after(async () => {
    await dbPool.close();
  });
});
