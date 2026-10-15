import { test } from "node:test";
import assert from "node:assert/strict";
import { ticketIsEligible, WALKUP_TICKET_TTL_MS } from "../ticketValidity.js";

test("legacy kiosk tickets without expiration stop reserving after 24 hours", () => {
  const now = Date.now();
  const ticket = {
    status: "active",
    tripId: null,
    expiresAt: null,
    createdAt: new Date(now - 1000),
  };
  assert.equal(ticketIsEligible(ticket, now), true);
  assert.equal(
    ticketIsEligible(
      { ...ticket, createdAt: new Date(now - WALKUP_TICKET_TTL_MS) },
      now,
    ),
    false,
  );
  assert.equal(
    ticketIsEligible(
      { ...ticket, createdAt: new Date(now - 10 * WALKUP_TICKET_TTL_MS) },
      now,
    ),
    false,
  );
  assert.equal(
    ticketIsEligible({ ...ticket, createdAt: undefined }, now),
    false,
  );
});

test("explicit deadlines and scheduled trip allocations retain their validity rules", () => {
  const now = Date.now();
  const old = {
    status: "active",
    createdAt: new Date(now - 10 * WALKUP_TICKET_TTL_MS),
  };
  assert.equal(
    ticketIsEligible({ ...old, expiresAt: new Date(now + 1000) }, now),
    true,
  );
  assert.equal(
    ticketIsEligible({ ...old, expiresAt: new Date(now - 1) }, now),
    false,
  );
  assert.equal(
    ticketIsEligible(
      { ...old, tripId: "scheduled-trip", expiresAt: null },
      now,
    ),
    true,
  );
  assert.equal(
    ticketIsEligible(
      { ...old, status: "cancelled", expiresAt: new Date(now + 1000) },
      now,
    ),
    false,
  );
});
