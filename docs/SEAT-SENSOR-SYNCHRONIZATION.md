# Seat occupancy and reservation synchronization

The system reuses Bus seats, Ticket reservations, the authenticated device API,
Activity history and the existing Mega-to-LilyGO serial bridge.

## State policy

- A valid active ticket protects the seat allocation. Its internal allocation
  flag remains `booked` even while the passenger is seated. This prevents resale;
  it is not the display label.
- `occupancy` records the pressure sensor's reading. `displayState` is the shared
  Available / Reserved / Occupied / Sensor unavailable view used by the kiosk,
  passenger app, staff bus management and tracking.
- Fresh occupied pressure takes priority over Reserved everywhere. The ticket,
  QR number, owner, assigned seat and trip history remain unchanged.
- When pressure disappears, the display remains Occupied for
  `SEAT_EMPTY_CONFIRM_MS` (default 1500 ms, maximum 30000 ms). Repeated identical
  empty readings do not restart this hold. After the hold, a valid active ticket
  makes the seat Reserved again, never available for resale. Without a valid
  ticket it becomes Available, provided the sensor is still fresh and online.
- Completing/cancelling a ticket or trip releases its allocation, but never
  overrides fresh physical occupancy. Ticket-bound locks prevent an old ticket's
  cleanup from releasing a newer sale. Expired ticket-bound locks are reclaimed
  on the next sale only when no other valid reservation exists.
- A stale or failed sensor does not make an unreserved seat available. The
  current installation monitors seats 1–5 only; unwired seats remain unavailable.

## Device API and ordering

`POST /api/bus/seats` requires the existing bus-bound device key. Example:

```json
{
  "busId": "BUS-001",
  "seatId": 12,
  "status": "occupied",
  "observedAt": 1792108800000
}
```

`observedAt` must be the actual current epoch time in milliseconds (the example
is illustrative). The seat must be configured in that bus's `monitoredSeatIds`.
Allowed states are `occupied`, `available`, and the legacy firmware alias
`booked` meaning physically occupied. For faults, send `sensor: "fault"` instead
of status. Strings/fractions for seat IDs, unconfigured live sensors, conflicting
fields, stale/future times and another bus's key are rejected.

The ESP32 now includes the sample time. Older or repeated timestamped packets do
not reverse a newer reading or create duplicate transition logs. Firmware without
timestamps remains compatible, using arrival order. Each seat update is an atomic
compare-and-swap that leaves allocations, GPS and other seats untouched. Changes
are sent first; unchanged sensors get quiet health refreshes. Wi-Fi/HTTPS retries
and the existing Mega 100 ms debounce remain in place.

Activity transitions include bus, seat, observation time, previous/current state
and the reservation reference when present. An audit event is saved in a durable
per-seat outbox in the same atomic write as its transition, then inserted once
into Activity. Failed writes recover on retry or backend startup. Empty detection
records the start of the hold; it does not claim the seat was immediately freed.

## Conductor verification

Pressure sensors cannot identify a person, detect ticket ownership, or establish
that the same person moved from one seat to another. Consequently:

- An occupied seat without an active ticket shows a staff warning.
- An occupied reserved seat shows a ticket-verification warning until checked.
- In Management → Buses, staff enter the occupant's full ticket QR reference.
  Checking a ticket assigned to another seat records a wrong-seat conflict;
  neither the ticket nor the seat assignment is changed.
- A matching active ticket clears the warning. An empty/occupied cycle requires
  another identity check; sensor readings never silently transfer a booking.

Verification and conflict details are staff-only. Public kiosk responses omit
ticket links, verification details and internal lock/audit metadata. Activity
history can be filtered by bus and seat. Staff bus and tracking screens refresh
every 2 seconds, with the passenger and kiosk seat monitors; network latency may
add to that interval. No manual page refresh is necessary.

## Deployment and hardware verification

1. Deploy the backend and frontend. No destructive migration or ticket deletion
   is required. Optionally configure `SEAT_EMPTY_CONFIRM_MS` on the backend.
2. Upload the updated LilyGO sketch to enable timestamp ordering. Existing Mega
   sensor firmware remains compatible, using MUX select pins D26–D29, SIG A0 for
   MUX1, CH0–CH4 for the five installed sensors and shared ground.
3. Reserve an installed seat through the kiosk. It should show Reserved on all
   monitors. Apply pressure: it should show Occupied while retaining its ticket.
   Release briefly: it should remain protected. After a sustained release it
   becomes Reserved while the ticket is active. Complete the ticket/trip: an
   empty, confirmed, online seat becomes Available.
4. Verify the conductor warnings and Activity rows. Check reconnects without
   creating duplicate tickets. Seat 12 is covered by the integration tests with
   an explicitly configured test sensor; physically testing it requires installing
   and configuring that sensor rather than marking unwired seats online.

Automated integration tests cover the full kiosk sale, all seat views, duplicate
sales, temporary vacancy, expiry, trip completion, wrong-seat verification,
bus-bound authorization, malformed/stale updates, concurrent writes and recovery
from an audit failure. Physical sensor behavior still needs a test on the bus.
