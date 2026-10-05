# TELE-PORT — Kiosk (Vite + React)

Complete, runnable React web app. `src/App.jsx` contains the whole
application (Passenger, Kiosk, and Super Admin views) sharing one
in-memory live state (buses, seats, tickets, routes, admins).

- `KioskAdminApp` — top-level kiosk shell (staff login target, mode toggle)
- `KioskTicketFlow` — passenger self-service screen: pick seat → pick
  drop-off → dispense ticket with QR code
- `KioskOperatorPanel` — staff-only "Staff tools" view: start/end trip,
  send location pings, seat sensor diagnostics, session log

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (default `http://localhost:5173`).

No backend is required — buses, tickets, and accounts all live in React
state and reset on page refresh.

## Build for production

```bash
npm run build
npm run preview
```

Output goes to `dist/`.

## Connecting to a real backend

To wire this up to MongoDB + Express, with seats driven by actual
Arduino/ESP32 sensors instead of the simulated interval, see the
`teleport-backend` and `teleport-firmware` code from earlier in the
conversation.
