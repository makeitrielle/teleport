import test from "node:test";
import assert from "node:assert/strict";
import { makeReceipt } from "../print-agent/printer.js";

const ticket = {
  bookingReference: "TEST-REFERENCE",
  ticketNumber: "TEST-TICKET",
  reservationStatus: "CONFIRMED",
  ride: "SEAT 3",
  passengerType: "senior",
  fare: 24,
  route: "PITX - SM Pala-Pala",
  scanUrl: "https://www.teleport-app.online/?ticket=TEST",
};

test("receipt preserves ticket, seat, fare and scannable URL in ESC/POS data", () => {
  const bytes = makeReceipt(ticket);
  const text = bytes.toString("ascii");
  for (const value of [
    ticket.bookingReference,
    ticket.ticketNumber,
    "SEAT 3",
    "SENIOR",
    "Php 24.00",
    ticket.scanUrl,
  ])
    assert.ok(text.includes(value));
  assert.ok(bytes.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])));
  assert.ok(!bytes.subarray(-4).equals(Buffer.from([0x1d, 0x56, 0x42, 0])));
  assert.ok(
    makeReceipt(ticket, true)
      .subarray(-4)
      .equals(Buffer.from([0x1d, 0x56, 0x42, 0])),
  );
});

test("rejects an oversized QR before any bytes can be submitted to Windows", () => {
  assert.throws(
    () => makeReceipt({ ...ticket, scanUrl: "x".repeat(701) }),
    /too long/,
  );
});
