import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import createApp from '../src/app.js';
import dbPool from '../src/infrastructure/database/DatabasePool.js';
import { runMigrations } from '../src/infrastructure/database/migrate.js';

const uid = () => Math.random().toString(36).substring(2, 9);

describe('Phase 4: API Layer, Middlewares, Token Auth & Observability', () => {
  let server;
  let baseUrl;

  before(async () => {
    await runMigrations();
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await dbPool.close();
  });

  it('GET /livez should return 200 alive status', async () => {
    const res = await fetch(`${baseUrl}/livez`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'alive');
  });

  it('GET /readyz should return 200 when database is healthy', async () => {
    const res = await fetch(`${baseUrl}/readyz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.database, 'connected');
  });

  it('GET /metrics should expose Prometheus observability counters and gauges', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('ticket_reservations_confirmed_total'));
    assert.ok(text.includes('ticket_reservations_declined_total'));
    assert.ok(text.includes('ticket_seats_status'));
    assert.ok(text.includes('ticket_http_requests_total'));
  });

  it('POST /shows and GET /shows/:id should create and retrieve show with reconciliation', async () => {
    const createRes = await fetch(`${baseUrl}/shows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Coldplay API Test ${uid()}`,
        total_seats: 10,
        price_paise: 500000,
        per_user_limit: 4,
      }),
    });

    assert.equal(createRes.status, 201);
    const show = await createRes.json();
    assert.ok(show.id);
    assert.equal(show.total_seats, 10);

    const getRes = await fetch(`${baseUrl}/shows/${show.id}`);
    assert.equal(getRes.status, 200);
    const data = await getRes.json();
    assert.equal(data.summary.total, 10);
    assert.equal(data.summary.available, 10);
    assert.equal(data.summary.confirmed, 0);
  });

  it('POST /shows/:id/reserve should reject requests without Bearer token (401)', async () => {
    const showRes = await fetch(`${baseUrl}/shows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auth Test Show', total_seats: 5, price_paise: 100000 }),
    });
    const show = await showRes.json();

    const res = await fetch(`${baseUrl}/shows/${show.id}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seats: ['S1'] }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'UNAUTHORIZED');
  });

  it('POST /shows/:id/reserve should reject body spoofing user_id (400)', async () => {
    const showRes = await fetch(`${baseUrl}/shows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Spoof Test Show', total_seats: 5, price_paise: 100000 }),
    });
    const show = await showRes.json();

    const res = await fetch(`${baseUrl}/shows/${show.id}/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_token_user_1',
      },
      body: JSON.stringify({
        seats: ['S1'],
        user_id: 'spoofed_user_id', // Strictly forbidden
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'IDENTITY_SPOOFING_FORBIDDEN');
  });

  it('POST /shows/:id/reserve should successfully reserve seats with token-derived identity (201)', async () => {
    const showRes = await fetch(`${baseUrl}/shows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Concert ${uid()}`, total_seats: 10, price_paise: 250000 }),
    });
    const show = await showRes.json();

    const userId = `usr_buyer_${uid()}`;
    const idempKey = `idemp_${uid()}`;

    const res = await fetch(`${baseUrl}/shows/${show.id}/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userId}`,
        'Idempotency-Key': idempKey,
      },
      body: JSON.stringify({ seats: ['S1', 'S2'] }),
    });

    assert.equal(res.status, 201);
    const booking = await res.json();
    assert.ok(booking.reservation_id);
    assert.equal(booking.status, 'confirmed');
    assert.deepEqual(booking.seats, ['S1', 'S2']);
    assert.equal(booking.user_id, userId);

    // Replay with identical key returns cached response (201)
    const replayRes = await fetch(`${baseUrl}/shows/${show.id}/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userId}`,
        'Idempotency-Key': idempKey,
      },
      body: JSON.stringify({ seats: ['S1', 'S2'] }),
    });
    assert.equal(replayRes.status, 201);
    const replayBody = await replayRes.json();
    assert.equal(replayBody.reservation_id, booking.reservation_id);

    // Conflicting reservation on already booked seats returns 409
    const conflictRes = await fetch(`${baseUrl}/shows/${show.id}/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer usr_other_${uid()}`,
        'Idempotency-Key': `idemp_${uid()}`,
      },
      body: JSON.stringify({ seats: ['S1'] }),
    });
    assert.equal(conflictRes.status, 409);
    const conflictBody = await conflictRes.json();
    assert.equal(conflictBody.error, 'SEAT_UNAVAILABLE');
  });

  it('POST /reservations/:id/cancel should allow owner and forbid impostors', async () => {
    const showRes = await fetch(`${baseUrl}/shows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Comedy ${uid()}`, total_seats: 10, price_paise: 200000 }),
    });
    const show = await showRes.json();

    const ownerId = `usr_owner_${uid()}`;
    const reserveRes = await fetch(`${baseUrl}/shows/${show.id}/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerId}`,
        'Idempotency-Key': `idemp_${uid()}`,
      },
      body: JSON.stringify({ seats: ['S3', 'S4'] }),
    });
    const booking = await reserveRes.json();

    // Impostor cancellation returns 403 Forbidden
    const impostorRes = await fetch(`${baseUrl}/reservations/${booking.reservation_id}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer usr_impostor',
      },
    });
    assert.equal(impostorRes.status, 403);

    // Owner cancellation returns 200 OK
    const ownerCancelRes = await fetch(`${baseUrl}/reservations/${booking.reservation_id}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerId}`,
      },
    });
    assert.equal(ownerCancelRes.status, 200);
    const cancelBody = await ownerCancelRes.json();
    assert.equal(cancelBody.status, 'cancelled');
    assert.equal(cancelBody.released_seats.length, 2);

    // Show state reflects seats available again
    const stateRes = await fetch(`${baseUrl}/shows/${show.id}`);
    const state = await stateRes.json();
    assert.equal(state.summary.available, 10);
    assert.equal(state.summary.confirmed, 0);
  });
});
