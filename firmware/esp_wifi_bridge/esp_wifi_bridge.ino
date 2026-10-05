/*
  TELE-PORT ESP32 Wi-Fi seat bridge
  Receives SEAT,<id>,BOOKED|AVAILABLE from Mega Serial1 and POSTs each
  latest state to POST /api/bus/seats. A reader task continues receiving
  while HTTP requests run; per-seat revisions coalesce and retry states.
*/
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <stdlib.h>
#include <string.h>

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* API_BASE_URL = "http://YOUR_SERVER_LAN_IP:4000/api";

constexpr uint8_t NUM_SEATS = 61;
constexpr int MEGA_RX_PIN = 16;
constexpr int MEGA_TX_PIN = 17;
constexpr uint32_t WIFI_RETRY_MS = 5000;
constexpr uint32_t HTTP_TIMEOUT_MS = 5000;

struct SeatMailbox {
  bool occupied;
  uint32_t revision;
};
SeatMailbox mailbox[NUM_SEATS] = {};
portMUX_TYPE mailboxMux = portMUX_INITIALIZER_UNLOCKED;
uint32_t deliveredRevision[NUM_SEATS] = {};

void acceptLine(char* line) {
  char* comma1 = strchr(line, ',');
  if (!comma1) return;
  *comma1 = '\0';
  char* comma2 = strchr(comma1 + 1, ',');
  if (!comma2) return;
  *comma2 = '\0';

  if (strcmp(line, "SEAT") != 0) return;
  char* end = nullptr;
  const long seatId = strtol(comma1 + 1, &end, 10);
  if (end == comma1 + 1 || *end != '\0' || seatId < 1 || seatId > NUM_SEATS) {
    Serial.printf("Ignored invalid seat id: %s\n", comma1 + 1);
    return;
  }

  bool occupied;
  if (strcmp(comma2 + 1, "BOOKED") == 0) occupied = true;
  else if (strcmp(comma2 + 1, "AVAILABLE") == 0) occupied = false;
  else {
    Serial.printf("Ignored invalid seat state: %s\n", comma2 + 1);
    return;
  }

  const uint8_t index = static_cast<uint8_t>(seatId - 1);
  portENTER_CRITICAL(&mailboxMux);
  mailbox[index].occupied = occupied;
  ++mailbox[index].revision;
  portEXIT_CRITICAL(&mailboxMux);
}

void serialReaderTask(void*) {
  char line[40];
  size_t length = 0;
  bool overflow = false;
  for (;;) {
    while (Serial2.available() > 0) {
      const char c = static_cast<char>(Serial2.read());
      if (c == '\r') continue;
      if (c == '\n') {
        if (!overflow && length > 0) {
          line[length] = '\0';
          acceptLine(line);
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

bool postSeat(uint8_t seatId, bool occupied) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClient client;
  HTTPClient http;
  const String url = String(API_BASE_URL) + "/bus/seats";
  if (!http.begin(client, url)) {
    Serial.println("HTTP initialization failed.");
    return false;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  const String body = String("{\"seatId\":") + seatId +
                      ",\"status\":\"" + (occupied ? "booked" : "available") + "\"}";
  const int code = http.POST(body);
  http.end();

  if (code >= 200 && code < 300) {
    Serial.printf("Seat %u -> %s (HTTP %d)\n", seatId,
                  occupied ? "booked" : "available", code);
    return true;
  }
  Serial.printf("Seat %u update failed (HTTP %d); will retry.\n", seatId, code);
  return false;
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, MEGA_RX_PIN, MEGA_TX_PIN);

  const BaseType_t taskStarted =
      xTaskCreate(serialReaderTask, "seatSerial", 4096, nullptr, 1, nullptr);
  if (taskStarted != pdPASS) {
    Serial.println("ERROR: could not start seat serial reader task.");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Connecting to Wi-Fi...");
}

void loop() {
  static uint32_t lastWiFiAttempt = 0;
  static uint32_t nextRetryAt = 0;
  static uint8_t scanFrom = 0;
  const uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWiFiAttempt >= WIFI_RETRY_MS) {
      lastWiFiAttempt = now;
      Serial.println("Wi-Fi disconnected; reconnecting.");
      WiFi.reconnect();
    }
    delay(20);
    return;
  }

  if (static_cast<int32_t>(now - nextRetryAt) < 0) {
    delay(5);
    return;
  }

  for (uint8_t offset = 0; offset < NUM_SEATS; ++offset) {
    const uint8_t index = (scanFrom + offset) % NUM_SEATS;
    bool occupied;
    uint32_t revision;
    portENTER_CRITICAL(&mailboxMux);
    revision = mailbox[index].revision;
    occupied = mailbox[index].occupied;
    portEXIT_CRITICAL(&mailboxMux);

    if (revision == 0 || revision == deliveredRevision[index]) continue;

    if (postSeat(index + 1, occupied)) {
      deliveredRevision[index] = revision;
      scanFrom = (index + 1) % NUM_SEATS;
    } else {
      nextRetryAt = millis() + 1000;
    }
    break;
  }
  delay(2);
}
