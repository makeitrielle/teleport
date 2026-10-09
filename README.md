# TELE-PORT — Full Stack (React + Express + MongoDB)

TELE-PORT is a full-stack bus seat monitoring and ticketing system consisting of a React/Vite frontend, an Express/MongoDB backend, and Arduino/ESP32 firmware for real-time seat monitoring.

## Project structure

```text
teleport-full-stack/
├── back/                    Express API + Mongoose models
├── front/                   React (Vite) kiosk application
├── firmware/                Arduino Mega + ESP32 firmware
├── docs/                    Hardware documentation and schematics
└── README.md
```

## Quick start

### 1. Backend

Open a terminal and run:

```bash
cd backend
npm install
```

Configure the required environment variables in the backend `.env` file.

Then start the backend:

```bash
npm run dev
```

The API runs on:

```text
http://localhost:4000
```

If the project requires demo database records, the seed script can be run with:

```bash
npm run seed
```

**Warning:** The seed script deletes existing database records before creating the demo data. Do not run it on a database containing data that must be preserved.

See `backend/README.md` for backend configuration, API routes, MongoDB setup, printing, and voice-alert information.

## 2. Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The Vite development server normally runs on:

```text
http://localhost:5173
```

The frontend communicates with the backend through `frontend/src/api.js`.

The application provides the bus, route, passenger, ticket, seat, notification, and kiosk-management interfaces.

A live backend is required for reservations and verification; the active application has no demo fallback.

## 3. Firmware

The firmware connects the physical seat sensors and GPS/communication hardware to the web application.

The system uses:

- Arduino Mega 2560
- FLEXKYS two-wire seat pressure mats
- CD74HC4067 16-channel multiplexers
- DFPlayer Mini voice module
- LILYGO T-SIM A7670E ESP32/GPS board

Currently, five physical seat sensors are connected for the prototype. Seats 1–5 are monitored by the Arduino, while seats 6–61 are reported as offline until their physical sensors are installed.

See:

```text
firmware/README.md
```

for the complete wiring and firmware configuration instructions.

The Arduino Mega firmware is located at:

```text
firmware/mega_seat_sensor/mega_seat_sensor.ino
```

The ESP32 firmware is located at:

```text
firmware/esp_wifi_bridge/
```

## 4. Hardware documentation

The hardware schematic is available at:

```text
docs/teleport-hardware-schematic.svg
```

Additional wiring information is provided in:

```text
firmware/WIRING.md
```

## Seat monitoring

The Arduino Mega reads the physical seat sensors and sends seat-status messages to the ESP32.

Seat updates use the following format:

```text
SEAT,<id>,BOOKED
SEAT,<id>,AVAILABLE
SEAT,<id>,OFFLINE
```

The ESP32 relays the information to the backend.

The backend then provides the current seat state to the frontend.

The system distinguishes between physical occupancy, ticket reservations, and offline sensors.

## Voice alerts

The Arduino Mega controls a DFPlayer Mini voice module.

Voice commands sent to the Mega use:

```text
VOICE,<file-number>
```

Voice files are stored on the DFPlayer microSD card under:

```text
/mp3/
```

For example:

```text
/mp3/0001.mp3
/mp3/0002.mp3
/mp3/0003.mp3
```

The firmware documentation contains the complete voice-alert wiring and configuration information.

## Important notes

### Database

The project uses MongoDB through Mongoose.

The database bus `BUS-001` should contain numeric seat IDs from 1 through 61.

### Environment variables

Do not commit passwords, API keys, MongoDB credentials, or other secrets to GitHub.

Use `.env` for local configuration and keep sensitive values out of source control.

### Physical sensors

Only seats with physically installed and connected sensors should be treated as online.

For the current prototype:

```text
Seats 1–5   → physical sensors connected
Seats 6–61  → reported as OFFLINE
```

### Git

The repository contains both the application source code and hardware/firmware files.

Do not force-push over the existing GitHub history unless you intentionally want to replace the remote repository history.

## Development

Typical development setup:

**Terminal 1 — Backend**

```bash
cd backend
npm install
npm run dev
```

**Terminal 2 — Frontend**

```bash
cd frontend
npm install
npm run dev
```

**Arduino**

Open:

```text
firmware/mega_seat_sensor/mega_seat_sensor.ino
```

in the Arduino IDE and upload it to the Arduino Mega 2560.

**ESP32**

Open the appropriate sketch in:

```text
firmware/esp_wifi_bridge/
```

and configure the Wi-Fi and backend connection settings before uploading.

---

For detailed backend, frontend, and hardware instructions, see the README files inside `back/`, `front/`, and `firmware/`.