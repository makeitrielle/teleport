# TELE-PORT — Full Stack (React + Express + MongoDB)

```
teleport-full-stack/
├── backend/     Express API + Mongoose models (connects to MongoDB)
├── frontend/    React (Vite) kiosk app
└── firmware/    Arduino Mega + ESP8266/ESP32 sketches for real seat sensors
```

## Quick start

**1. Backend**
```bash
cd backend
npm install
cp .env.example .env      # then edit .env with your MongoDB connection string
npm run seed               # loads demo buses/routes/admins/passengers
npm run dev                 # starts API on http://localhost:4000
```

**2. Frontend** (in a second terminal)
```bash
cd frontend
npm install
cp .env.example .env        # only needed if your backend isn't on localhost:4000
npm run dev                  # starts app on http://localhost:5173
```

The frontend is already wired to the backend (see `frontend/src/api.js`).
On load it fetches buses, routes, kiosk admins, passengers, and
notifications from the API, and persists bus/route/admin CRUD, seat
bookings, trip status, and ticket issuing back to it. If the backend
isn't reachable, it automatically falls back to local demo data and shows
a banner saying nothing will be saved — so you can still run the frontend
on its own without MongoDB if you just want to look at it.

See `backend/README.md` for the full API reference, MongoDB connection
setup (Atlas or local), and a note on the couple of screens (passenger
login/signup, ticket scanning) that are intentionally left on local demo
data due to a data-model mismatch — with instructions on how to wire
those too if you want them.

**3. Firmware** (optional — real FSR seat sensors instead of the frontend's simulated toggling)

See `firmware/README.md` for wiring an Arduino Mega with FSR pressure
sensors to an ESP8266/ESP32, which relays live seat occupancy to the
backend over WiFi.
