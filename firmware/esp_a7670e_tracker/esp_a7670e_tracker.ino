/*
  TELE-PORT — LilyGO T-SIM A7670E R2 tracker (GPS + WiFi)
  ------------------------------------------------------------
  Replaces esp_wifi_bridge.ino. Does everything that sketch did
  (listens to the Mega over serial, POSTs seat updates to the
  backend) PLUS reads the board's onboard GPS and periodically
  PATCHes the bus's route progress and ETA over WiFi. The A7670E modem
  remains enabled for its onboard GPS.

  REQUIRED LIBRARY:
    LilyGO's TinyGSM fork from LilyGo-Modem-Series (not upstream TinyGSM).
    Use the A7670 driver: its GNSS commands differ from SIM7600.
    https://github.com/Xinyuan-LilyGO/LilyGo-Modem-Series

  PINS (confirmed against LilyGO's official T-A7670 quick-start —
  these are fixed by the board, don't change them):
    BOARD_PWRKEY_PIN   4   - pulses the modem on
    BOARD_POWERON_PIN  12  - must be HIGH or the modem resets on
                              battery power
    MODEM_RESET_PIN    5
    MODEM_TX_PIN       26  - ESP32 -> modem
    MODEM_RX_PIN       27  - ESP32 <- modem
  Arduino IDE board settings: "ESP32 Dev Module", Upload Speed
  921600, Partition Scheme "Huge APP (3MB No OTA/1MB SPIFFS)", PSRAM Enabled.

  Wiring to the Mega (NOTE: different pins than esp_wifi_bridge.ino used -
  see the board UART pin mapping at MEGA_RX_PIN/MEGA_TX_PIN below):
    ESP32 RX (GPIO21) <- [voltage divider from Mega TX1, pin 18]
    ESP32 TX (GPIO22) -> Mega RX1 (pin 19)
    ESP32 GND <-> Mega GND
  GPIO21/22 are the free default SDA/SCL pins on this board - not used by the
  modem, the SD card slot, or PSRAM. Still double check against
  LilyGO's pin diagram for your exact board revision before wiring.

  Fill in every value in the CONFIG block below before uploading.
*/

#define TINY_GSM_MODEM_A7670
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <TinyGsmClient.h>
#include <ArduinoJson.h>
#ifndef TINY_GSM_FORK_LIBRARY
#error "Install LilyGO TinyGSM from LilyGo-Modem-Series for the A7670 GNSS driver."
#endif
#include <stdlib.h>
#include <string.h>

// ================= CONFIG =================

// --- WiFi ---
// Replace these placeholders with your WiFi network name and password.
const char* WIFI_SSID = "Zhen";
const char* WIFI_PASSWORD = "Kissmuna";

// --- Backend server ---
// For WiFi testing, this can be your backend's LAN IP when the backend
// computer and ESP32 are on the same WiFi; otherwise use a public host.
const char* SERVER_HOST = "teleport-3qfa.onrender.com";
const int   SERVER_PORT = 443;
const char* API_BASE_PATH = "/api";

// This system represents exactly ONE bus. BUS-001 is its stable,
// human-readable identifier - no need to look up a Mongo ObjectId
// anymore, since this board talks to the singleton /api/bus/* routes
// (see backend/routes/bus.js) instead of /api/buses/:id.
const char* BUS_ID = "BUS-001";
// Keep per-device credentials outside source control. Copy device_config.example.h.
#if __has_include("device_config.h")
#include "device_config.h"
#else
#define TELEPORT_DEVICE_KEY ""
#define TELEPORT_CA_CERT ""
#endif
// The GNSS library's `accuracy` value is dimensionless DOP, not meters.
float latestGpsDop = NAN;
uint8_t latestFixStatus = 0;

bool configureSecureClient(WiFiClientSecure& client) {
  if (strlen(TELEPORT_DEVICE_KEY) < 32 || strlen(TELEPORT_CA_CERT) == 0) {
    Serial.println("Configure the device key and HTTPS CA certificate before sending telemetry.");
    return false;
  }
  if (time(nullptr) < 1704067200) {
    Serial.println("HTTPS waiting for network time synchronization.");
    return false;
  }
  client.setCACert(TELEPORT_CA_CERT);
  return true;
}

// --- Route stops (must match this bus's `stops` array order in MongoDB) ---
// SM Dasmariñas (Pala-pala terminal), Cavite -> PITX, Parañaque. Real-world
// coordinates confirmed via Wikipedia/OSM - this matches a real bus route
// (SM Dasmariñas's own transport terminal runs route 27 to PITX/Lawton).
struct Stop {
  const char* name;
  float lat;
  float lon;
};
Stop STOPS[] = {
  { "PITX",                      14.51012, 120.99130 },
  { "SM Dasmarinas (Pala-pala)", 14.3015,  120.9567 },
};
const int NUM_STOPS = sizeof(STOPS) / sizeof(STOPS[0]);

// How close (in meters) counts as "arrived" at a stop
const float ARRIVAL_RADIUS_M = 100.0;

// Used for ETA when the GPS hasn't reported a speed yet (e.g. just booted)
const float FALLBACK_SPEED_KMH = 20.0;

// How often to check GPS and push a progress/ETA update
const unsigned long GPS_POLL_INTERVAL_MS = 5000;
const float DROPOFF_ALERT_RADIUS_M = 250.0;

// ============================================

// ---- Modem pins ----
#define BOARD_PWRKEY_PIN   4
#define BOARD_POWERON_PIN  12
#define MODEM_RESET_PIN    5
#define MODEM_DTR_PIN      25
#define MODEM_TX_PIN       26
#define MODEM_RX_PIN       27

#define SerialMon Serial
#define SerialAT  Serial1
#define MEGA_SERIAL Serial2
// IMPORTANT: this board (T-SIM A7670E R2) is built on an ESP32-WROVER-E.
// On WROVER modules, GPIO16 and GPIO17 are wired internally to the
// module's own PSRAM and are NOT available as general-purpose pins -
// using them (as the old plain-ESP32 esp_wifi_bridge.ino did) will not
// work on this board. GPIO2/13/14/15 are also already used by this
// board's microSD slot. GPIO21/22 are the free default SDA/SCL pins on this board instead.
#define MEGA_RX_PIN 21
#define MEGA_TX_PIN 22

TinyGsm modem(SerialAT);

constexpr uint8_t NUM_SEATS = 61;
struct SeatMailbox {
  bool occupied;
  bool online;
  uint32_t revision;};
SeatMailbox seatMailbox[NUM_SEATS] = {};
portMUX_TYPE seatMailboxMux = portMUX_INITIALIZER_UNLOCKED;
uint32_t deliveredRevision[NUM_SEATS] = {};
uint8_t nextSeatToSend = 0;
unsigned long seatRetryAt = 0;

void serialReaderTask(void*);
void processPendingSeat();
void checkDropoffAlerts(float lat, float lon);
bool requestDropoffs(String& response);
bool acknowledgeDropoff(const String& ticketId);
bool sendApiRequest(const char* method, const String& path, const String& jsonBody);

bool modemReady = false;
bool gpsEnabled = false;
unsigned long lastModemAttempt = 0;

void maintainGps() {
  if (gpsEnabled) return;
  if (millis() - lastModemAttempt < 30000) return;
  lastModemAttempt = millis();
  if (!modemReady) {
    // GNSS + Wi-Fi works without a SIM. modem.init() requires a ready SIM
    // in this library, so test the UART directly instead.
    modemReady = modem.testAT(1000);
    if (!modemReady) {
      SerialMon.println("Modem not responding; check board power and modem UART pins.");
      return;
    }
    modem.sendAT("E0");
    modem.waitResponse();
    SerialMon.println("Modem: " + modem.getModemName());
  }
  // T-A7670 has no separate GNSS power-enable GPIO.
  gpsEnabled = modem.isEnableGPS() || modem.enableGPS(-1, 0);
  if (gpsEnabled) {
    modem.setGPSBaud(115200);
    SerialMon.println("GPS enabled. Place the GPS antenna outdoors and wait for a fix.");
  } else {
    SerialMon.println("A7670 GNSS enable failed; retrying in 30 seconds. Check the modem variant supports built-in GNSS.");
  }
}

unsigned long lastGpsCheck = 0;
int currentStopIndex = 0;   // origin endpoint for the current direction
bool routeDirectionSet = false;
bool routeComplete = false;
float legDistances[16];     // distance of each leg, filled in setup()
float totalRouteDistance = 0;

// ================= SETUP =================

void setup() {
  SerialMon.begin(115200);
  delay(100);

  MEGA_SERIAL.begin(9600, SERIAL_8N1, MEGA_RX_PIN, MEGA_TX_PIN);
  if (xTaskCreate(serialReaderTask, "seatSerial", 4096, nullptr, 1, nullptr) != pdPASS) {
    SerialMon.println("ERROR: could not start Mega serial reader task.");
  }

  precomputeRouteDistances();
  modemPowerOn();

  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(3000);

  SerialMon.println("Initializing A7670 modem...");
  lastModemAttempt = millis() - 30000;
  maintainGps();
  connectWifi();

}

// ================= LOOP =================

void loop() {
  maintainWifi();
  maintainGps();

  unsigned long now = millis();
  if (now - lastGpsCheck >= GPS_POLL_INTERVAL_MS) {
    lastGpsCheck = now;
    if (gpsEnabled) checkGpsAndUpdate();
  }

  // GPS/drop-off alerts have priority over the queued seat telemetry.
  processPendingSeat();
}

// ================= MODEM POWER-ON =================

void modemPowerOn() {
  pinMode(BOARD_POWERON_PIN, OUTPUT);
  digitalWrite(BOARD_POWERON_PIN, HIGH);  // keep modem powered even on battery

  pinMode(MODEM_RESET_PIN, OUTPUT);
  // T-A7670 reset is active HIGH; release it LOW before using the modem.
  digitalWrite(MODEM_RESET_PIN, LOW);
  delay(100);
  digitalWrite(MODEM_RESET_PIN, HIGH);
  delay(2600);
  digitalWrite(MODEM_RESET_PIN, LOW);
  pinMode(MODEM_DTR_PIN, OUTPUT);
  digitalWrite(MODEM_DTR_PIN, LOW);  // keep the modem awake

  pinMode(BOARD_PWRKEY_PIN, OUTPUT);
  digitalWrite(BOARD_PWRKEY_PIN, LOW);
  delay(100);
  digitalWrite(BOARD_PWRKEY_PIN, HIGH);
  delay(1000);
  digitalWrite(BOARD_PWRKEY_PIN, LOW);
  delay(1000);
}

// ================= WIFI CONNECTION =================

void connectWifi() {
  if (strcmp(WIFI_SSID, "your_wifi_name") == 0) {
    SerialMon.println("Set WIFI_SSID and WIFI_PASSWORD before connecting.");
    return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  SerialMon.print("Connecting to WiFi");
  const unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(500);
    SerialMon.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    SerialMon.print(" connected. IP: ");
    SerialMon.println(WiFi.localIP());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  } else {
    SerialMon.println(" failed; will retry in background.");
  }
}

void maintainWifi() {
  if (strcmp(WIFI_SSID, "your_wifi_name") == 0) return;
  if (WiFi.status() == WL_CONNECTED) {
    static bool timeRequested = false;
    if (!timeRequested) {
      configTime(0, 0, "pool.ntp.org", "time.google.com");
      timeRequested = true;
    }
    return;
  }
  static unsigned long lastRetry = 0;
  if (millis() - lastRetry < 10000) return;
  lastRetry = millis();
  SerialMon.println("WiFi disconnected, reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// ================= SEAT BRIDGE =================

void acceptSeatLine(char* line) {
  char* comma1 = strchr(line, ',');
  if (!comma1) return;
  *comma1 = 0;
  char* comma2 = strchr(comma1 + 1, ',');
  if (!comma2) return;
  *comma2 = 0;
  if (strcmp(line, "SEAT") != 0) return;

  char* end = nullptr;
  const long seatId = strtol(comma1 + 1, &end, 10);
  if (end == comma1 + 1 || *end != 0 || seatId < 1 || seatId > NUM_SEATS) return;

  bool occupied = false;
  bool online = true;
  if (strcmp(comma2 + 1, "BOOKED") == 0) occupied = true;
  else if (strcmp(comma2 + 1, "AVAILABLE") == 0) occupied = false;
  else if (strcmp(comma2 + 1, "OFFLINE") == 0) online = false;
  else return;

  const uint8_t index = static_cast<uint8_t>(seatId - 1);
  portENTER_CRITICAL(&seatMailboxMux);
  seatMailbox[index].occupied = occupied;
  seatMailbox[index].online = online;
  ++seatMailbox[index].revision;
  portEXIT_CRITICAL(&seatMailboxMux);
}
void serialReaderTask(void*) {
  char line[40];
  size_t length = 0;
  bool overflow = false;
  for (;;) {
    while (MEGA_SERIAL.available() > 0) {
      const char c = static_cast<char>(MEGA_SERIAL.read());
      if (c == '\r') continue;
      if (c == '\n') {
        if (!overflow && length > 0) {
          line[length] = '\0';
          acceptSeatLine(line);
        }
        length = 0;
        overflow = false;
      } else if (!overflow) {
        if (length < sizeof(line) - 1) line[length++] = c;
        else overflow = true;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

void processPendingSeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (static_cast<long>(millis() - seatRetryAt) < 0) return;

  for (uint8_t offset = 0; offset < NUM_SEATS; ++offset) {
    const uint8_t index = (nextSeatToSend + offset) % NUM_SEATS;
    bool occupied;
    bool online;
    uint32_t revision;
    portENTER_CRITICAL(&seatMailboxMux);
    revision = seatMailbox[index].revision;
    occupied = seatMailbox[index].occupied;
    online = seatMailbox[index].online;
    portEXIT_CRITICAL(&seatMailboxMux);
    if (revision == 0 || revision == deliveredRevision[index]) continue;

    String body = String("{\"busId\":\"") + BUS_ID + "\",\"seatId\":" + String(index + 1);
    if (online) {
      body += String(",\"status\":\"") + (occupied ? "booked" : "available") + "\"}";
    } else {
      body += ",\"sensor\":\"fault\"}";
    }

    const bool ok = sendApiRequest("POST", String(API_BASE_PATH) + "/bus/seats", body);
    if (ok) {
      deliveredRevision[index] = revision;
      nextSeatToSend = (index + 1) % NUM_SEATS;
      if (online) SerialMon.printf("Seat %u -> %s (sent)\n", index + 1, occupied ? "booked" : "available");
      else SerialMon.printf("Seat %u -> OFFLINE (sent)\n", index + 1);
    } else {
      seatRetryAt = millis() + 3000;
      SerialMon.printf("Seat %u update failed; will retry.\n", index + 1);
    }
    return;
  }
}
// ================= GPS / PROGRESS / ETA =================

void precomputeRouteDistances() {
  totalRouteDistance = 0;
  for (int i = 0; i < NUM_STOPS - 1; i++) {
    legDistances[i] = haversineMeters(STOPS[i].lat, STOPS[i].lon, STOPS[i + 1].lat, STOPS[i + 1].lon);
    totalRouteDistance += legDistances[i];
  }
}

void checkGpsAndUpdate() {
  float lat = NAN, lon = NAN, speedKmh = 0, alt = 0, accuracy = NAN;
  int vsat = 0, usat = 0, year = 0, month = 0, day = 0, hour = 0, minute = 0, sec = 0;
  uint8_t fixStatus = 0;  // LilyGO's TinyGSM fork reports the fix mode first
  bool gotFix = modem.getGPS(&fixStatus, &lat, &lon, &speedKmh, &alt, &vsat, &usat, &accuracy,
                              &year, &month, &day, &hour, &minute, &sec);

  if (!gotFix || fixStatus < 2 || !isfinite(lat) || !isfinite(lon) ||
      lat < -90.0f || lat > 90.0f || lon < -180.0f || lon > 180.0f) {
    SerialMon.println("No GPS fix yet.");
    return;
  }

  latestGpsDop = accuracy;
  latestFixStatus = fixStatus;

  // TinyGSM reports A7670 speed in knots; convert to km/h for the API/UI.
  // Missing GNSS fields can be returned as a negative sentinel. Keep the
  // valid position, but never use that sentinel as movement or send it to API.
  if (!isfinite(speedKmh) || speedKmh < 0) {
    SerialMon.println("GPS speed unavailable; sending zero speed with the valid position.");
    speedKmh = 0;
  } else {
    speedKmh *= 1.852f;
  }

  if (!routeDirectionSet) {
    const float toStart = haversineMeters(lat, lon, STOPS[0].lat, STOPS[0].lon);
    const float toEnd = haversineMeters(lat, lon, STOPS[NUM_STOPS - 1].lat, STOPS[NUM_STOPS - 1].lon);
    currentStopIndex = (toStart <= toEnd) ? 0 : NUM_STOPS - 1;
    routeDirectionSet = true;
    SerialMon.print("Route direction starts at: ");
    SerialMon.println(STOPS[currentStopIndex].name);
  }

  SerialMon.print("GPS fix: ");
  SerialMon.print(lat, 6);
  SerialMon.print(", ");
  SerialMon.print(lon, 6);
  SerialMon.print("  speed=");
  SerialMon.print(speedKmh);
  SerialMon.println(" km/h");
  checkDropoffAlerts(lat, lon);

  // When a completed bus leaves its terminal, start tracking the return leg.
  if (routeComplete && haversineMeters(lat, lon, STOPS[currentStopIndex].lat,
                                       STOPS[currentStopIndex].lon) > ARRIVAL_RADIUS_M * 2) {
    routeComplete = false;
    SerialMon.print("Return trip started from: ");
    SerialMon.println(STOPS[currentStopIndex].name);
  }

  if (routeComplete) {
    sendBusUpdate(lat, lon, speedKmh, year, month, day, hour, minute, sec, 1.0f, 0, "idle");
    return;
  }

  const int nextStopIndex = (currentStopIndex == 0) ? NUM_STOPS - 1 : 0;
  float distToNextStop = haversineMeters(lat, lon, STOPS[nextStopIndex].lat, STOPS[nextStopIndex].lon);

  if (distToNextStop <= ARRIVAL_RADIUS_M) {
    currentStopIndex = nextStopIndex;
    routeComplete = true;
    SerialMon.print("Arrived at stop: ");
    SerialMon.println(STOPS[currentStopIndex].name);

    sendBusUpdate(lat, lon, speedKmh, year, month, day, hour, minute, sec, 1.0f, 0, "idle");
    return;
  }

  // ---- Still traveling: compute progress + ETA ----
  float completed = haversineMeters(STOPS[currentStopIndex].lat, STOPS[currentStopIndex].lon, lat, lon);
  if (completed > totalRouteDistance) completed = totalRouteDistance;
  float progress = totalRouteDistance > 0 ? completed / totalRouteDistance : 0;

  float effectiveSpeed = (speedKmh > 2.0) ? speedKmh : FALLBACK_SPEED_KMH;  // avoid div-by-zero when stopped
  float remainingKm = distToNextStop / 1000.0;
  int etaMin = max(1, (int)round((remainingKm / effectiveSpeed) * 60.0));

  sendBusUpdate(lat, lon, speedKmh, year, month, day, hour, minute, sec, progress, etaMin, "active");
}

// Zero-pads a number to 2 digits for timestamp formatting (e.g. 5 -> "05").
String pad2(int n) {
  return n < 10 ? "0" + String(n) : String(n);
}

float haversineMeters(float lat1, float lon1, float lat2, float lon2) {
  const float R = 6371000.0;  // Earth radius, meters
  float dLat = radians(lat2 - lat1);
  float dLon = radians(lon2 - lon1);
  float a = sin(dLat / 2) * sin(dLat / 2) +
            cos(radians(lat1)) * cos(radians(lat2)) * sin(dLon / 2) * sin(dLon / 2);
  float c = 2 * atan2(sqrt(a), sqrt(1 - a));
  return R * c;
}

// Sends the GPS fix plus the firmware's own progress/ETA calculation to
// the singleton /api/bus/location route. busId, latitude, longitude,
// speed, and timestamp match the payload shape this system standardizes
// on; progress/etaMin/status are the extra fields that route also
// accepts so the passenger map keeps working exactly as before.
// timestamp uses the GPS module's own UTC date/time (not millis(), which
// is only time-since-boot and resets on every power cycle).
void sendBusUpdate(float lat, float lon, float speedKmh,
                    int year, int month, int day, int hour, int minute, int sec,
                    float progress, int etaMin, const char* status) {
  String timestamp = String(year) + "-" + pad2(month) + "-" + pad2(day) +
                      "T" + pad2(hour) + ":" + pad2(minute) + ":" + pad2(sec) + "Z";

  if (!isfinite(latestGpsDop) || latestGpsDop <= 0) { SerialMon.println("GNSS quality unavailable; retaining prior GPS until it becomes stale."); return; }
  String path = String(API_BASE_PATH) + "/bus/location";
  String body = "{\"busId\":\"" + String(BUS_ID) + "\"" +
                ",\"dop\":" + String(latestGpsDop, 2) +
                ",\"fixStatus\":" + String(latestFixStatus) +
                ",\"latitude\":" + String(lat, 6) +
                ",\"longitude\":" + String(lon, 6) +
                ",\"speed\":" + String(speedKmh, 1) +
                ",\"timestamp\":\"" + timestamp + "\"" +
                ",\"progress\":" + String(progress, 4) +
                ",\"etaMin\":" + String(etaMin) +
                ",\"status\":\"" + status + "\"}";
  bool ok = sendApiRequest("POST", path, body);
  SerialMon.println(ok ? "Bus update sent." : "Bus update FAILED.");
}


// Fetch active ticket pins, announce once when the bus is within 250 m,
// then acknowledge the ticket so later GPS polls do not repeat the alert.
bool requestDropoffs(String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  if (!configureSecureClient(client)) return false;
  HTTPClient http;
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
  http.setReuse(false);
  const String path = String(API_BASE_PATH) + "/bus/dropoffs?busId=" + BUS_ID;
  const String url = String("https://") + SERVER_HOST + ":" + SERVER_PORT + path;
  if (!http.begin(client, url)) return false;
  http.addHeader("Authorization", String("Bearer ") + TELEPORT_DEVICE_KEY);
  const int code = http.GET();
  bool ok = false;
  if (code == 200) {
    // getString decodes HTTP chunk framing before JSON parsing.
    response = http.getString();
    ok = !response.isEmpty();
  } else {
    SerialMon.printf("Drop-off list request failed: HTTP %d\n", code);
  }
  http.end();
  return ok;
}

bool acknowledgeDropoff(const String& ticketId) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  // Use the same trusted CA and device identity for every request.
  if (!configureSecureClient(client)) return false;
  if (!client.connect(SERVER_HOST, SERVER_PORT)) return false;
  const String path = String(API_BASE_PATH) + "/bus/dropoffs/" + ticketId + "/alerted?busId=" + String(BUS_ID);
  client.print("POST " + path + " HTTP/1.1\r\nHost: " + SERVER_HOST + "\r\nAuthorization: Bearer " + TELEPORT_DEVICE_KEY + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  const unsigned long started = millis();
  String status;
  while ((client.connected() || client.available()) && millis() - started < 5000) {
    while (client.available()) {
      const char c = static_cast<char>(client.read());
      if (c == '\n') { client.stop(); return status.indexOf(" 2") > 0; }
      if (c != '\r') status += c;
    }
    delay(1);
  }
  client.stop();
  return false;
}

void checkDropoffAlerts(float lat, float lon) {
  String payload;
  if (!requestDropoffs(payload)) return;
  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, payload)) {
    SerialMon.println("Could not parse pending drop-off list.");
    return;
  }
  JsonArrayConst dropoffs = doc.as<JsonArrayConst>();
  bool voicePlayed = false;
  for (JsonObjectConst dropoff : dropoffs) {
    const char* id = dropoff["id"] | "";
    const float targetLat = dropoff["lat"] | NAN;
    const float targetLon = dropoff["lon"] | NAN;
    if (id[0] == '\0' || isnan(targetLat) || isnan(targetLon)) continue;
    const float distance = haversineMeters(lat, lon, targetLat, targetLon);
    if (distance > DROPOFF_ALERT_RADIUS_M) continue;
    if (!voicePlayed) {
      // Per-stop clip chosen by the backend; 1 is the generic announcement.
      const int clip = dropoff["clip"] | 1;
      MEGA_SERIAL.println("VOICE," + String(clip));
      voicePlayed = true;
    }
    SerialMon.printf("Drop-off alert for %s at %.0f m.\n", id, distance);
    if (!acknowledgeDropoff(String(id))) SerialMon.println("Drop-off alert acknowledgement failed; it may repeat.");
  }
}
// ================= HTTP over WiFi =================

bool sendApiRequest(const char* method, const String& path, const String& jsonBody) {
  if (WiFi.status() != WL_CONNECTED) {
    SerialMon.println("No WiFi connection, dropping request.");
    return false;
  }
  WiFiClientSecure client;
  if (!configureSecureClient(client)) return false;
  HTTPClient http;
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
  http.setReuse(false);
  const String url = String("https://") + SERVER_HOST + ":" + SERVER_PORT + path;
  if (!http.begin(client, url)) {
    SerialMon.println("Could not initialize HTTPS request.");
    return false;
  }
  http.addHeader("Authorization", String("Bearer ") + TELEPORT_DEVICE_KEY);
  http.addHeader("Content-Type", "application/json");
  const int code = http.sendRequest(method, jsonBody);
  const bool ok = code >= 200 && code < 300;
  if (!ok) {
    SerialMon.printf("Server response: HTTP %d\n", code);
    if (code < 0) {
      SerialMon.println("HTTPS transport: " + HTTPClient::errorToString(code));
      char tlsError[160] = {0};
      const int tlsCode = client.lastError(tlsError, sizeof(tlsError));
      SerialMon.printf("TLS error: %d %s\n", tlsCode, tlsError);
      IPAddress backendAddress;
      if (WiFi.hostByName(SERVER_HOST, backendAddress)) {
        SerialMon.printf("Backend DNS: %s -> %s:%d\n", SERVER_HOST,
                         backendAddress.toString().c_str(), SERVER_PORT);
      } else {
        SerialMon.println("Backend DNS lookup failed; check WiFi internet access.");
      }
    } else {
      // Log only the API's error field, never response credentials or bus records.
      JsonDocument response;
      if (!deserializeJson(response, http.getString()) && response["error"].is<const char*>()) {
        String error = response["error"].as<String>();
        SerialMon.println("API error: " + error.substring(0, 240));
      }
    }
  }
  http.end();
  return ok;
}
