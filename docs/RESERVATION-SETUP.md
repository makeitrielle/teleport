# SM Pala-Pala passenger app and kiosk

## Start the updated project

Use Node.js 22.12 or newer and the existing MongoDB database. The authoritative code is now `backend/` and `frontend/`. Legacy `back/` and `front/` entry commands delegate to these directories, so both entry points use the same application and models.

From the project folder in a VS Code terminal:

```powershell
npm run setup
```

Configure `backend/.env` from `.env.example`, preserving your existing `MONGODB_URI`. Set `APP_URL` to your passenger website and `ALLOWED_ORIGINS` to its exact origin. For local development, allow `http://localhost:5173,http://127.0.0.1:5173`. Configure Resend's `RESEND_API_KEY` and verified `EMAIL_FROM` for registration and password reset.

On a hosted reverse proxy, configure `TRUST_PROXY_HOPS` to the provider's verified proxy count (for example, `1` for exactly one trusted proxy). This allows per-client rate limiting rather than treating every passenger as the proxy. Leave it unset when connecting directly; do not guess a proxy count.

Open two terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Passenger site: `http://localhost:5173/`. Staff sign-in and console: `http://localhost:5173/staff/`. Passenger kiosk: `http://localhost:5173/kiosk/`. The old `/?mode=kiosk` URL also works. The production build includes separate HTML entry pages for all three, so deploy the complete `frontend/dist/` folder. Production uses HTTPS. Prefer a reverse proxy for `/api` on the same website origin. If deploying the API separately, set `VITE_API_URL` before building and configure allowed origins, credentialed cookies and `COOKIE_CROSS_SITE=true`. Browsers may block cross-site cookies; a same-origin proxy avoids this issue.

## Initial administrator

### Vercel and Render session cookies

The included `vercel.json` files support deploying from either the repository root or `frontend/`. They force the Vercel build to use `VITE_API_URL=/api` and proxy `/api/*` to `https://teleport-3qfa.onrender.com/api/*`. This keeps the browser's session cookie on the passenger website rather than relying on a third-party Render cookie. If the backend hostname changes, update both rewrite destinations.

On Render, set `NODE_ENV=production`, `COOKIE_CROSS_SITE=false`, `APP_URL=https://teleport-app.online`, and `ALLOWED_ORIGINS=https://teleport-app.online,https://www.teleport-app.online`. Include any other actual frontend origin you use, such as your Vercel preview hostname, explicitly. Redeploy the frontend after committing the proxy configuration, then sign in again. Protected requests should use `https://teleport-app.online/api/...`, rather than calling the Render hostname directly. The frontend now checks that login actually persisted a session before opening the dashboard.

`beforeinstallprompt` messages concern the PWA installation banner and do not cause login failures.

Legacy staff accounts retain their credentials and default to Staff. A successful login upgrades a legacy SHA256 password hash to salted scrypt. No account is automatically elevated to Administrator.

When there is no administrator, set these temporary environment variables in the backend terminal, then run the bootstrap command:

```powershell
$env:BOOTSTRAP_ADMIN_ID='your-unused-staff-id'
$env:BOOTSTRAP_ADMIN_NAME='your-administrator-name'
$env:BOOTSTRAP_ADMIN_PASSWORD='your-own-strong-password'
npm --prefix backend run bootstrap-admin
Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
Remove-Item Env:BOOTSTRAP_ADMIN_ID
Remove-Item Env:BOOTSTRAP_ADMIN_NAME
```

The command refuses to overwrite an existing staff account or create another bootstrap administrator. Sign in through **Staff sign in**. Manage verified physical buses, routes, schedules, account roles and passenger category reviews. Verify eligibility documents before approving Student, PWD or Senior Citizen categories. Unverified accounts pay the existing regular fare.

## Schedules and bookings

Publish real departures, optional known arrival/duration and explicitly verified seat IDs. No schedules or seat inventory are invented. First/last departures are derived from published trips for the selected Philippine calendar day. The existing fare matrix supports PITX ↔ SM Pala-Pala routes; other routes require an authorized fare configuration before booking.

Passenger reservations are attached to the signed-in account. Physical occupancy and scheduled seat reservations remain distinct. Walk-up tickets require a sensor reading no older than 90 seconds and staff category review. GPS and seat displays poll every ten seconds; schedules refresh every thirty seconds. Payment selection and Standing are absent from the active booking workflow. Historical records are retained.

Walk-up issuance is blocked on buses with open published reservations, so it cannot bypass scheduled seat inventory. Use the scheduled passenger booking flow for those buses. Completing/cancelling legacy walk-up tickets releases their reservation lock while preserving physical sensor occupancy.

Tickets use an unpredictable 256-bit verification number. The QR is generated locally, without an external QR-image service. The kiosk generates new walk-up tickets; it does not scan or accept existing ticket numbers. Possession authorizes a minimal confirmation, with a masked passenger identifier. It cannot access the account or cancel a booking. Authorized boarding/completion consumes the ticket; simply scanning does not consume it or create another reservation. Cancelled, completed and expired tickets are rejected.

Expiry follows the known scheduled arrival. When arrival is unknown, the current validity policy is scheduled duration plus a two-hour boarding allowance; if duration is unknown, it is 26 hours after departure. This is a ticket validity limit, never a claimed arrival time. Review this policy with operations before deployment. Walk-up tickets expire after 24 hours.

Optional passenger drop-off pins feed the existing onboard destination voice alert. These are separate from the configured 100-meter pickup target. The onboard destination alert retains its existing 250-meter threshold.

## Database changes and preservation

Existing Bus, Ticket, Passenger, Admin, Route and Notification collections remain in use. New Trip, Session and Activity collections use the same `MONGODB_URI`. Added fields are backward compatible. Unknown historical ownership is not reassigned; legacy walk-up records remain staff-visible.

Startup waits for the unique active `(tripId, seatId)` index before accepting bookings. This partial index excludes historical walk-up tickets and prevents concurrent duplicate seat allocation. Session tokens are hashed in MongoDB and expire after eight hours; their HttpOnly cookie is secure in production. Password resets and staff permission changes revoke sessions. The existing sparse email uniqueness migration remains in place. Index creation failure stops startup, instead of allowing unsafe booking.

No destructive seed, record deletion, bulk replacement or live database migration was executed during this update. Do not run the old `seed` script on your existing database: it is a destructive development utility. Back up MongoDB before deployment. Activity records have no indiscriminate Clear History action because no retention policy is configured.

## Authenticated GPS and seat hardware

In **Management → Tracking setup**, configure each bus's actual target coordinates and generate its device key. Set `BUS_ID` on that bus's tracker to exactly the configured ID. Copy `firmware/esp_a7670e_tracker/device_config.example.h` to `device_config.h`; configure its key and the actual trusted root CA certificate for `SERVER_HOST`. The private header is ignored by Git. The tracker validates HTTPS and refuses telemetry without configuration. Flash the updated sketch after setting the Wi-Fi credentials and server address. Existing sensor mailbox, retry, route and voice-alert logic is preserved.

Every hardware request must provide `Authorization: Bearer <device-key>` and the matching stable bus ID. The backend never silently assigns telemetry to a different bus.

```http
POST /api/bus/location
Authorization: Bearer <this-bus-device-key>
Content-Type: application/json

{
  "busId": "your-configured-bus-id",
  "latitude": 14.300,
  "longitude": 120.950,
  "speed": 0,
  "timestamp": "<actual UTC GPS fix time in ISO 8601>",
  "accuracy": 10
}
```

Coordinates above illustrate the payload format only; they are not configured targets or live telemetry. Supply your measured coordinates and timestamp. Accuracy is optional and must be an actual metric accuracy estimate. The LilyGO/TinyGSM interface instead sends its dimensionless `dop` and `fixStatus` (2D/3D), without converting DOP to meters. Quality gating accepts metric accuracy ≤50 meters or a valid 2D/3D fix with DOP >0 and ≤3. This is a quality filter, not a guarantee of absolute position error. Missing/poor quality shows Location unavailable. Fixes older than 120 seconds, out of order or more than 30 seconds in the future are rejected; previous positions become stale.

Distance uses Haversine, with entry at ≤100 meters. An atomic approach flag suppresses duplicate alerts. It re-arms only after a fresh, qualified position exceeds 130 meters, then alerts on the next ≤100-meter entry. Stale/missing data never counts as an exit. Staff receive an in-app notification; relevant active-booking passengers receive a private notification. These are polled in-app notifications, not background push notifications.

Seat reporting uses `POST /api/bus/seats` with the same authorization and `{busId, seatId, status: "booked" | "available"}` or `{busId, seatId, sensor: "fault"}`. Physical occupancy cannot be overwritten through ordinary passenger requests. The optional legacy `esp_wifi_bridge` now sends bus ID and device authorization too; its HTTP transport is intended for a trusted development LAN. Its folder contains a second historical `.ino`; compile only the bridge sketch in a clean sketch directory or use the canonical LilyGO tracker in production.

## Printer and kiosk

Keep the existing XP-58 Windows printer driver and agent. Configure `backend/print-agent/.env` using its example: `WS_URL` points to the backend `/api/printer/agent`, `AGENT_SECRET` matches the backend, and `PRINTER_NAME` is the installed Windows printer name. Set `PUBLIC_APP_URL` to the passenger site. Start on the physical Windows kiosk:

```powershell
npm --prefix backend run print-agent
```

Print Receipt sends authenticated, one-use jobs through the existing WebSocket agent and Windows raw ESC/POS spooler. It includes branding, booking reference, full ticket number, QR, bus, route, category, departure and confirmation time. No browser print dialog is used. Agent/spooler acceptance does not prove the paper physically printed. Paper-out detection depends on the Windows driver; staff must check paper and printer health.

Definite failures allow retry. A disconnected or unconfirmed job is marked uncertain to prevent accidental duplicates. Staff must inspect the physical printer, then resolve the uncertain result from the ticket screen. Already printed receipts require staff authorization to reprint. A receipt does not create a new booking or prove bus proximity. One active print agent is supported; connecting another replaces the previous agent.

Open `/kiosk/` directly; passengers do not need a staff or passenger login. Touch Screen to Begin opens passenger type, seat selection, destination, ticket and print. The layout contains 61 seats: eleven rows of 3 + 2 and a six-seat rear row. Seats 1–5 are restricted to PWD and senior passengers. Discount categories require the passenger's eligibility declaration; this is recorded separately from staff verification. Seat selection still requires fresh, available sensor data. Unknown or unmonitored seats are displayed as unavailable. The kiosk generates a QR receipt for the passenger app without scanning. Finish returns to the welcome screen; receipts reset after 90 seconds. Staff management routes stay protected.

## Verification completed and live checks remaining

- Automated integration tests use an isolated temporary MongoDB and a test WebSocket printer agent. They never use the production URI. Registration/email/reset are tested with a simulated email provider, not real outgoing email.
- All 24 integration tests passed. The legacy frontend build also delegates successfully to the authoritative frontend.
- Tested account privacy, sessions and authorization; real MongoDB concurrent seat allocation; schedules and multiple buses; all four category results; malformed/unknown/cancelled/expired tickets; repeated verification; Haversine 100-meter boundary; poor/stale/unavailable fixes; device isolation; entry suppression/re-entry; sensor occupancy; history/notification scope; offline printer, job acceptance, failure and reprint authorization.
- Browser QA used explicitly named TEST fixtures: passenger sign-in, saved mobile booking, account reopening, kiosk verification, printer-offline confirmation preservation, reset, and theme/layout checks. No TEST data is shipped as a production fallback.
- React production build and the canonical ESP32/LilyGO sketch compile successfully. Dependency audits were cleared for the updated canonical frontend/backend.
- Still required on your devices: actual Resend delivery, production deployment/cookies, camera decoding and repeated scans using physical QR codes, actual GPS/sensor reporting after flash, physical XP-58 printing/paper-out behavior and PWA installation on target Android/iOS devices. A real connected GPS fix, camera scan or physical print was not available in this session.

Run tests from the root with `npm test`; the first isolated test run may download a MongoDB binary. To reproduce browser QA only, set `TELEPORT_TEST_MODE=true` and run `backend/tests/ui-server.js` with the development frontend. Its documented test credentials work only in that ephemeral test database. Stop that process before starting your real backend. Production never runs it automatically.

The PWA caches only its shell and static assets. APIs and personal ticket records are not cached. Schedules, verification, booking changes and tracking require the live backend. Build with `npm run build` and deploy `frontend/dist`.
