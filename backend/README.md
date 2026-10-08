# TELE-PORT Backend (Express + MongoDB)

REST API backend for the TELE-PORT kiosk app, using Express and Mongoose.
Matches the data shapes used in the React frontend: buses (with embedded
seats), routes, admins, passengers, tickets, and notifications.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Get a MongoDB connection string**
   - Free hosted option: [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) → create a cluster → create a database user → Network Access → allow your IP → copy the connection string.
   - Or run MongoDB locally and use `mongodb://localhost:27017/teleport`.

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `MONGODB_URI`, `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_URL`.
   Verify `teleport-app.online` in Resend before using `auth@teleport-app.online` as
   the sender. Set `APP_URL` to the public frontend origin (currently
   `https://tele-port-ecru.vercel.app`) so confirmation and password-reset links
   return to the deployed app. Change it to `https://teleport-app.online` after
   that custom domain is connected to the Vercel project.

4. **Seed the database** (optional, but recommended — loads the same demo data the frontend used to have in mock state)
   ```bash
   npm run seed
   ```
   This creates 3 buses, 2 routes, 2 kiosk admins, and 3 passengers.
   Default password for all seeded admins/passengers: `password123`.

5. **Run the server**
   ```bash
   npm run dev
   ```
   Server starts on `http://localhost:4000` (change `PORT` in `.env` if needed).

6. **Check it's alive**
   ```bash
   curl http://localhost:4000/api/health
   ```

## API Overview

| Method | Endpoint                          | Purpose                              |
|--------|------------------------------------|---------------------------------------|
| GET    | `/api/buses`                       | list all buses                       |
| GET    | `/api/buses/:id`                   | get one bus                          |
| POST   | `/api/buses`                       | create a bus                         |
| PATCH  | `/api/buses/:id`                   | update bus (progress, status, etc.)  |
| PATCH  | `/api/buses/:id/seats/:seatId`     | update one seat (status/sensor)      |
| DELETE | `/api/buses/:id`                   | delete a bus                         |
| GET    | `/api/routes`                      | list routes                          |
| POST   | `/api/routes`                      | create a route                       |
| GET    | `/api/admins`                      | list kiosk admins                    |
| POST   | `/api/admins`                      | create a kiosk admin                 |
| POST   | `/api/admins/login`                | kiosk staff login                    |
| GET    | `/api/passengers`                  | list passengers                      |
| POST   | `/api/passengers/signup`           | passenger signup                     |
| POST   | `/api/passengers/login`            | passenger login                      |
| GET    | `/api/tickets?busId=&passengerId=` | list tickets, optional filters       |
| POST   | `/api/tickets`                     | dispense a ticket (books the seat)   |
| PATCH  | `/api/tickets/:id`                 | mark used / cancel (frees the seat)  |
| GET    | `/api/printer/status`              | check whether the kiosk print agent is connected |
| POST   | `/api/printer/jobs`                | send a one-time-authorized ticket to the kiosk printer |
| GET    | `/api/notifications`               | list notifications                   |
| POST   | `/api/notifications`               | create a notification                |

## Direct XP-58 kiosk printing

The kiosk uses a local Windows print agent so the online app can send a ticket
to the XP-58 over a secure WebSocket. The agent sends a 58 mm ESC/POS receipt
through the Windows RAW spooler, avoiding browser page scaling. It must run on
the same Windows computer as the printer; do not run it on Render.

1. In Render, add `AGENT_SECRET` to the backend service environment. Generate a
   unique value with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Keep this secret out of the frontend and source control. Set `PUBLIC_APP_URL`
   to the canonical passenger website URL used by ticket QR codes.
2. Redeploy the backend so it accepts the agent connection.
3. On the Windows kiosk, install Node.js 18 or later and the Xprinter 58-series
   driver. Confirm the Windows printer queue name (your screenshot shows
   `XP-58`).
4. Copy `backend/print-agent/.env.example` to `backend/print-agent/.env`. Set
   `WS_URL` to `wss://YOUR-RENDER-BACKEND.onrender.com/api/printer/agent`, copy
   the exact same `AGENT_SECRET`, and set `PRINTER_NAME` to the Windows queue
   name. Leave `CUT_AFTER_PRINT=false` unless the printer's cutter is enabled.
5. Open a terminal in `backend` and run `npm install` once. Start the agent by
   double-clicking `backend/print-agent/START-PRINT-AGENT.bat`. Keep that window
   running while the kiosk is in use.
6. Open `https://YOUR-RENDER-BACKEND.onrender.com/api/printer/status`. It should
   return `agentConnected: true`. Issue a ticket and choose **Print ticket on
   XP-58**. If the agent is offline, the kiosk offers Edge printing as fallback.

Ticket creation returns a high-entropy, one-use print authorization. The API
stores only its hash; the agent connection is separately protected by
`AGENT_SECRET`. Reprints should use Edge printing or a new ticket rather than
reuse a consumed authorization.

## Frontend wiring — what's connected

The React app (`frontend/src/App.jsx`) is already wired to this API via
`frontend/src/api.js`. On load it fetches buses, routes, admins,
passengers, and notifications from the backend. If the backend can't be
reached, it falls back to local in-memory demo data and shows a banner
saying nothing will be saved — so the frontend still runs standalone if
you just want to look at it without setting up MongoDB.

**Persisted through the API (when the backend is reachable):**
- Buses: create / edit / delete (Super Admin → Buses tab)
- Routes: create / edit / delete (Super Admin → Routes tab)
- Kiosk admins: create / edit / delete (Super Admin → Kiosk admins tab)
- Seat booking + sensor overrides (Kiosk → Staff tools)
- Trip start/stop and location pings (Kiosk → Staff tools)
- Ticket issuing at the kiosk (Kiosk → Passenger kiosk flow)

**Still local-only / not wired to the backend:**
- The passenger-side "scan ticket" flow (`TicketScanScreen`) matches
  tickets already held in local React state rather than looking them up
  by `qrCode` via `GET /api/tickets`.

If you want this wired too, the pattern used everywhere else in
`App.jsx` is: call the matching `api.xxx()` function, convert the result
with `withId(...)`, then update React state from the response instead of
mutating it locally.

## Security note

Passwords are hashed with SHA-256 here as a simple placeholder. For a real
deployment, install `bcryptjs` and use salted bcrypt hashes instead, and
put this API behind HTTPS.
