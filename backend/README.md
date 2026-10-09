# SM Pala-Pala shared API

See [complete setup, database changes, hardware configuration and testing](../docs/RESERVATION-SETUP.md).

Use Node 22.12+; install with `npm install`. Configure `.env` from `.env.example` using the existing MongoDB URI, then run `npm run dev` or `npm start`. Run `npm test` for isolated integration tests. An initial administrator is created explicitly with `npm run bootstrap-admin` and temporary bootstrap environment variables; no default production credentials are supplied.

## API access

- Public: passenger signup/login/email/reset, staff login, schedules, capability-based `/verify`, printer connection status.
- Passenger session: `/session`, `/logout`, own `/reservations`, `/activity`, `/notifications`, `/tracking` and account profile.
- Staff session: trip management, booking administration/boarding, bus viewing, walk-up tickets, receipt reconciliation, route management and operational activity.
- Administrator session: bus configuration, GPS target/device keys, staff accounts and category eligibility review.
- Device key: all `/bus/*` endpoints require a stable bus ID and that bus's bearer key.
- Print agent: `/printer/agent` WebSocket requires the separately configured agent secret. `/printer/jobs` consumes a hashed one-use print authorization.

All paths are under `/api`. Passenger and kiosk records are stored in the same Ticket collection. Trip, Session and Activity collections add scheduling, expiring sessions and history without deleting legacy records.

The historical `seed` script remains destructive. Do not run it on the existing database.
