# TELE-PORT seat sensor firmware

This setup uses an Arduino Mega 2560, 61 two-wire FLEXKYS seat pressure mats, four CD74HC4067 16-channel multiplexers, a DFPlayer Mini voice module with speaker and microSD card, and a LILYGO T-SIM A7670E ESP32/GPS board. The ESP32 sends GPS and seat updates to the backend over WiFi; its A7670E modem supplies GPS only in this configuration.

## Sensor and multiplexer wiring

Use four mux boards. Connect Mega 5V to each mux VCC, Mega GND to each mux GND, and tie each mux EN pin to GND (enabled). Share the four address lines across all boards:

- Mega D22 → S0
- Mega D23 → S1
- Mega D24 → S2
- Mega D25 → S3

Connect the four mux SIG pins to Mega A0, A1, A2, and A3 respectively.

For the five currently connected sensors (seats 1–5, first row), connect one sensor lead to its mux channel and the other sensor lead to GND. Polarity does not matter.

The Mega uses `INPUT_PULLUP` on each SIG input, so an unpressed/open sensor reads HIGH (available) and a pressed/closed sensor reads LOW (occupied). Do not connect the sensors to 5V.

Firmware reports seats 6–61 offline/unavailable without scanning their channels.

Seat mapping:

- MUX 1 channels 0–15 → seats 1–16
- MUX 2 channels 0–15 → seats 17–32
- MUX 3 channels 0–15 → seats 33–48
- MUX 4 channels 0–12 → seats 49–61
- MUX 4 channels 13–15 → unused

## Speaker / voice alert wiring

For MP3-TF-16P wiring and a simple sound test, see [MP3_TF_16P.md](MP3_TF_16P.md). The standalone `mp3_tf_16p_test` sketch plays clips when you type 1, 2, or 3; upload the combined Mega seat sketch again afterwards.

- Mega D16 (TX2) → 1 kOhm series resistor → DFPlayer RX
- DFPlayer TX → Mega D17 (RX2)
- DFPlayer VCC → regulated 5V supply
- DFPlayer GND → common GND shared with Mega and LILYGO
- Passive speaker (4 ohm, up to 3W) → DFPlayer SPK1 and SPK2
- Do not connect either speaker terminal to GND.
- Insert a FAT32 microSD card with alert audio at `/mp3/0001.mp3` and additional numbered files if needed.

The DFPlayer Mini has a built-in speaker amplifier and is controlled by the Mega. Install the `DFRobotDFPlayerMini` Arduino library.

The ESP32 tracker can send `VOICE,<file-number>` to the Mega over the existing UART. The Mega plays the matching `/mp3/0001.mp3` file.

## Mega to LILYGO A7670E UART

- Mega TX1 (D18) → 10 kOhm / 20 kOhm divider → LILYGO GPIO21 (RX)
- LILYGO GPIO22 (TX) → Mega RX1 (D19)
- Mega GND ↔ LILYGO GND

Do not connect the Mega's 5V TX signal directly to an ESP32 input.

The LILYGO receives seat updates from the Mega and uses WiFi to reach the backend.

## Firmware selection and configuration

Flash `mega_seat_sensor.ino` to the Arduino Mega.

For the LILYGO T-SIM A7670E board, flash `esp_a7670e_tracker/esp_a7670e_tracker.ino` from its own sketch folder. It receives Mega seat readings over UART and sends GPS and seat updates over WiFi using authenticated HTTPS to `teleport-3qfa.onrender.com`, the same backend used by the website.

Copy `esp_a7670e_tracker/device_config.example.h` to `device_config.h` in that folder. Configure the bus device key generated in the staff tracking setup and a valid trusted root CA certificate for the backend. Configure WiFi credentials in the tracker sketch and keep `BUS_ID` identical to the database bus ID (`BUS-001` by default). Keep device keys and WiFi passwords private.

The separate `esp_wifi_bridge` is a seat-only LAN development alternative; its default URL is a placeholder and it does not replace the GPS tracker.

The ESP32 sends GPS information and seat updates to the backend. It can also check passenger drop-off locations and instruct the Mega to play the appropriate voice alert.

The backend chooses the voice clip from the drop-off label. The voice files include:

- `0001` = generic fallback
- `0002` = PITX
- `0003` = SM Pala-Pala
- `0101`–`0106` = 5–30 km from PITX
- `0201`–`0206` = 5–30 km from SM Pala-Pala

Copy the complete `sd_card/mp3` folder to the root of the DFPlayer's FAT32 microSD card.

## Seat monitoring and backend

The seat route is:

```text
POST /api/bus/seats
```

On boot, the Mega reports seats 1–5 as online and seats 6–61 as `OFFLINE`.

The ESP32 relays the sensor status to the backend.

Online seat readings are refreshed every 20 seconds. The website considers a reading live for 90 seconds; after that, the seat is shown as **Sensor offline**.

Physical occupancy is stored separately from a ticket reservation, so the system can distinguish between:

- occupied seat
- reserved seat
- available seat
- offline sensor

The ticket API rejects seats whose sensor is offline or reports occupied.

Passenger tickets must include `dropoffLocation` with latitude and longitude.

The tracker reads:

```text
GET /api/bus/dropoffs
```

and acknowledges alerts using:

```text
POST /api/bus/dropoffs/:ticketId/alerted
```

The database bus (`BUS-001`) must contain numeric seat IDs 1 through 61.

The project seed configures 61 seats, but running the seed script deletes existing database records. **Do not run the seed script on a database containing data that must be preserved.**

## Verification

Open the Mega and LILYGO serial monitors at 115200 baud.

The Mega prints each initial seat state and later changes in the following format:

```text
SEAT,<id>,BOOKED
SEAT,<id>,AVAILABLE
```

Offline sensors are reported as:

```text
SEAT,<id>,OFFLINE
```

The LILYGO should print successful communication/HTTP responses.

Confirm that changing a physical seat sensor produces the corresponding seat-status change on the website.

See [WIRING.md](WIRING.md) for the full pin-by-pin wiring diagram and power notes.
