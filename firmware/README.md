# TELE-PORT seat sensor firmware

This setup uses an Arduino Mega 2560, 61 two-wire FLEXKYS seat pressure mats, four CD74HC4067 16-channel multiplexers, a DFPlayer Mini voice module with speaker and microSD card, and a LILYGO T-SIM A7670E ESP32/GPS board. The ESP32 sends GPS and seat updates to the backend over WiFi; its A7670E modem supplies GPS only in this configuration.

## Sensor and multiplexer wiring

Use four mux boards. Connect Mega 5V to each mux VCC, Mega GND to each mux GND, and tie each mux EN pin to GND (enabled). Share the four address lines across all boards: Mega D22 to S0, D23 to S1, D24 to S2, and D25 to S3. Connect the four mux SIG pins to Mega A0, A1, A2, and A3 respectively.

For the five currently connected sensors (seats 1-5, first row), connect one sensor lead to its mux channel and the other sensor lead to GND. Polarity does not matter. The Mega INPUT_PULLUP on each SIG input makes an unpressed/open sensor read HIGH (available) and a pressed/closed sensor read LOW (occupied). Do not connect the sensors to 5V. Firmware reports seats 6-61 offline/unavailable without scanning their channels. Seats map in groups of 16: mux 1 channels 0-15 are seats 1-16; mux 2 is seats 17-32; mux 3 is seats 33-48; mux 4 channels 0-12 are seats 49-61. The remaining three channels are unused.

## Speaker / voice alert wiring

- Mega D16 (TX2) -> 1 kOhm series resistor -> DFPlayer RX
- DFPlayer TX -> Mega D17 (RX2)
- DFPlayer VCC -> regulated 5V supply; DFPlayer GND -> common GND shared with Mega and LILYGO
- Passive speaker (4 ohm, up to 3W) -> DFPlayer SPK1 and SPK2. Do not connect either speaker terminal to GND.
- Insert a FAT32 microSD card with alert audio at /mp3/0001.mp3 (and additional numbered files if needed).

The DFPlayer Mini has a built-in speaker amplifier and is controlled by the Mega. Install the DFRobotDFPlayerMini Arduino library. The GPS tracker sends VOICE,<file-number> to the Mega over the existing UART; the Mega plays the matching /mp3/0001.mp3 file.
## Mega to LILYGO A7670E UART

- Mega TX1 (D18) -> 10 kOhm / 20 kOhm divider -> LILYGO GPIO21 (RX)
- LILYGO GPIO22 (TX) -> Mega RX1 (D19)
- Mega GND <-> LILYGO GND

Do not connect the Mega's 5V TX signal directly to an ESP32 input. The LILYGO receives seat updates from the Mega and uses WiFi to reach the backend.

## Firmware selection and configuration

Flash mega_seat_sensor.ino to the Mega and firmware/esp_a7670e_tracker/esp_a7670e_tracker.ino to the LILYGO T-SIM A7670E R2. Set WIFI_SSID and WIFI_PASSWORD in the LILYGO sketch. Install TinyGSM and ArduinoJson in the ESP32 Arduino environment. If the backend is on the same WiFi network, SERVER_HOST may be the backend computer's LAN IP; otherwise use a publicly reachable hostname/IP and port. The ESP32 sends GPS fixes and seat updates to the backend, and checks passenger drop-off pins after each valid GPS fix. Within 250 m of a ticket drop-off, it tells the Mega to play the announcement clip and acknowledges that ticket through the backend. The backend chooses the clip from the drop-off label (backend/voiceClips.js): 0002 = PITX, 0003 = SM Pala-Pala, 0101-0106 = 5-30 km from PITX, 0201-0206 = 5-30 km from SM Pala-Pala, and 0001 = generic fallback. Copy the whole sd_card/mp3 folder to the root of the DFPlayer's FAT32 microSD card.

The seat route is POST /api/bus/seats. On boot, the Mega reports seats 1-5 online and seats 6-61 OFFLINE; the ESP32 relays offline sensor status to the backend. It refreshes online readings every 20 seconds. The website shows a reading as live for 90 seconds, then changes that seat to Sensor offline. Physical occupancy is stored separately from a ticket reservation, so an occupied seat, a reserved seat, and an offline sensor have distinct states. The ticket API rejects seats whose sensor is offline or reports occupied. Passenger tickets must include dropoffLocation with latitude and longitude. The tracker reads GET /api/bus/dropoffs and acknowledges alerts with POST /api/bus/dropoffs/:ticketId/alerted. The database bus (BUS-001) must contain numeric seat IDs 1 through 61. The project seed configures 61 seats, but running the seed script deletes existing database records; do not run it on data you need to keep.

## Verification

Open both serial monitors at 115200 baud. The Mega prints each initial seat state and later changes as SEAT,<id>,BOOKED or SEAT,<id>,AVAILABLE. The LILYGO prints successful HTTP responses. Confirm the matching seat changes on the website.

See [WIRING.md](WIRING.md) for the full pin-by-pin wiring diagram and power notes.
