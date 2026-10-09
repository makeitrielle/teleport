# SM Pala-Pala reservation implementation

Use the existing React/Vite frontend, Express API, MongoDB database, Bus, Passenger, Admin and Ticket collections. Existing ticket and printer integration remains authoritative. No seed or destructive migration is run.

Implementation order:
1. Add secure password verification, expiring server sessions, ownership checks and staff roles.
2. Add dated trip schedules, account-owned reservations, secure ticket verification and activity events to the same database.
3. Authenticate per-bus telemetry and calculate proximity with fresh, accurate GPS data and re-entry suppression.
4. Add a responsive passenger and kiosk interface, booking confirmation, scanner reset, printer integration, administration, themes and installation support.
5. Run security, geofence, booking validation and frontend checks. Document hardware and deployment limitations.

Unknown schedules and operating hours are displayed as unavailable until administrators configure them. Live database, camera, GPS and printer validation requires those services and devices; automated fixtures are used only in tests.

Validation: 24 isolated MongoDB integration tests passed, passenger/kiosk browser booking and verification checked, React production build passed, and the canonical ESP32/LilyGO sketch compiled. Configuration and outstanding real-device checks are documented in [RESERVATION-SETUP.md](RESERVATION-SETUP.md).
