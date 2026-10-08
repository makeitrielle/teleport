#line 1 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
/*
  TELE-PORT seat occupancy scanner and voice alert player
  Board: Arduino Mega 2560
  Sensors: 61 two-wire FLEXKYS mats via four CD74HC4067 modules
  Voice player: DFPlayer Mini on Mega Serial2; speaker driven by DFPlayer

  The ESP32 sends SEAT,<id>,BOOKED|AVAILABLE lines to Serial1.
  The ESP32 can also send VOICE,<file-number> to play /mp3/0001.mp3 etc.
*/

#include <Arduino.h>
#include <DFRobotDFPlayerMini.h>
#include <stdlib.h>
#include <string.h>

constexpr uint8_t NUM_SEATS = 61;
// WIRING.md documents only seats 1-5 connected to MUX1 CH0-CH4.
// Keep the count matched to the actual installed mats so unwired mux
// channels cannot produce false occupancy readings.
constexpr uint8_t ONLINE_SENSOR_COUNT = 5;
constexpr uint8_t NUM_MUXES = 4;
constexpr uint8_t MUX_SELECT_PINS[4] = {22, 23, 24, 25}; // S0, S1, S2, S3
constexpr uint8_t MUX_SIG_PINS[NUM_MUXES] = {A0, A1, A2, A3};
// Give the mux output time to settle after changing address, then use a
// majority vote to reject brief transitions and contact noise.
constexpr unsigned long DEBOUNCE_MS = 180;
constexpr unsigned int MUX_SETTLE_US = 300;
constexpr unsigned int SAMPLE_GAP_US = 100;
constexpr uint8_t CHANNEL_SAMPLE_COUNT = 7;
constexpr unsigned long SENSOR_HEARTBEAT_MS = 20000;

DFRobotDFPlayerMini voicePlayer;
bool voicePlayerReady = false;
bool stableOccupied[NUM_SEATS];
bool candidateOccupied[NUM_SEATS];
unsigned long candidateSince[NUM_SEATS];
unsigned long lastSensorHeartbeat = 0;

#line 39 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
bool readSeatOccupied(uint8_t seatIndex);
#line 58 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
void reportOfflineSeat(uint8_t index);
#line 67 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
void reportSeat(uint8_t index, bool occupied);
#line 80 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
void handleEspCommand(char* line);
#line 99 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
void pollEspCommands();
#line 121 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
void setup();
#line 170 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
void loop();
#line 39 "C:\\Users\\Administrator\\Downloads\\teleport-full-stack\\firmware\\mega_seat_sensor\\mega_seat_sensor.ino"
bool readSeatOccupied(uint8_t seatIndex) {
  const uint8_t muxIndex = seatIndex / 16;
  const uint8_t channel = seatIndex % 16;

  for (uint8_t bit = 0; bit < 4; ++bit) {
    digitalWrite(MUX_SELECT_PINS[bit], (channel & (1U << bit)) ? HIGH : LOW);
  }
  delayMicroseconds(MUX_SETTLE_US);
  // Discard the first read after switching channels, then sample several
  // times. The mux's SIG pin is configured INPUT_PULLUP in setup().
  (void)digitalRead(MUX_SIG_PINS[muxIndex]);
  uint8_t lowSamples = 0;
  for (uint8_t sample = 0; sample < CHANNEL_SAMPLE_COUNT; ++sample) {
    delayMicroseconds(SAMPLE_GAP_US);
    if (digitalRead(MUX_SIG_PINS[muxIndex]) == LOW) ++lowSamples;
  }
  return lowSamples > CHANNEL_SAMPLE_COUNT / 2;
}

void reportOfflineSeat(uint8_t index) {
  const uint8_t seatId = index + 1;
  Serial1.print(F("SEAT,"));
  Serial1.print(seatId);
  Serial1.println(F(",OFFLINE"));
  Serial.print(F("SEAT,"));
  Serial.print(seatId);
  Serial.println(F(",OFFLINE"));
}
void reportSeat(uint8_t index, bool occupied) {
  const uint8_t seatId = index + 1;
  Serial1.print(F("SEAT,"));
  Serial1.print(seatId);
  Serial1.print(',');
  Serial1.println(occupied ? F("BOOKED") : F("AVAILABLE"));

  Serial.print(F("SEAT,"));
  Serial.print(seatId);
  Serial.print(',');
  Serial.println(occupied ? F("BOOKED") : F("AVAILABLE"));
}

void handleEspCommand(char* line) {
  if (strncmp(line, "VOICE,", 6) != 0) return;

  char* end = nullptr;
  const long fileNumber = strtol(line + 6, &end, 10);
  if (end == line + 6 || *end != '\0' || fileNumber < 1 || fileNumber > 255) {
    Serial.println(F("Ignored invalid VOICE command."));
    return;
  }
  if (!voicePlayerReady) {
    Serial.println(F("Voice alert skipped: DFPlayer is not ready."));
    return;
  }

  voicePlayer.playMp3Folder(static_cast<uint16_t>(fileNumber));
  Serial.print(F("Playing voice clip "));
  Serial.println(fileNumber);
}

void pollEspCommands() {
  static char line[32];
  static uint8_t length = 0;
  static bool overflow = false;

  while (Serial1.available() > 0) {
    const char c = static_cast<char>(Serial1.read());
    if (c == '\r') continue;
    if (c == '\n') {
      if (!overflow && length > 0) {
        line[length] = '\0';
        handleEspCommand(line);
      }
      length = 0;
      overflow = false;
    } else if (!overflow) {
      if (length < sizeof(line) - 1) line[length++] = c;
      else overflow = true;
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600); // Mega <-> LILYGO A7670E
  Serial2.begin(9600); // Mega <-> DFPlayer Mini

  for (uint8_t bit = 0; bit < 4; ++bit) {
    pinMode(MUX_SELECT_PINS[bit], OUTPUT);
    digitalWrite(MUX_SELECT_PINS[bit], LOW);
  }
  for (uint8_t mux = 0; mux < NUM_MUXES; ++mux) {
    pinMode(MUX_SIG_PINS[mux], INPUT_PULLUP);
  }

  // Keep all muxes enabled: their EN pins are wired to GND.
  delay(10);

  voicePlayerReady = voicePlayer.begin(Serial2, true, true);
  if (voicePlayerReady) {
    voicePlayer.setTimeOut(500);
    voicePlayer.volume(20); // 0-30
    Serial.println(F("DFPlayer ready."));
  } else {
    Serial.println(F("DFPlayer not found; seat monitoring will continue."));
  }

  const unsigned long now = millis();
  for (uint8_t i = 0; i < NUM_SEATS; ++i) {
    candidateSince[i] = now;
    if (i < ONLINE_SENSOR_COUNT) {
      stableOccupied[i] = readSeatOccupied(i);
      candidateOccupied[i] = stableOccupied[i];
      Serial.print(F("MUX "));
      Serial.print((i / 16) + 1);
      Serial.print(F(" CH"));
      Serial.print(i % 16);
      Serial.print(F(" -> seat "));
      Serial.print(i + 1);
      Serial.print(F(": "));
      Serial.println(stableOccupied[i] ? F("occupied") : F("available"));
      reportSeat(i, stableOccupied[i]);
    } else {
      stableOccupied[i] = false;
      candidateOccupied[i] = false;
      reportOfflineSeat(i);
    }
  }
  Serial.println(F("Ready: seats 1-5 online; seats 6-61 reported offline."));
}

void loop() {
  pollEspCommands();

  const unsigned long now = millis();
  for (uint8_t i = 0; i < ONLINE_SENSOR_COUNT; ++i) {
    const bool readingOccupied = readSeatOccupied(i);

    if (readingOccupied != candidateOccupied[i]) {
      candidateOccupied[i] = readingOccupied;
      candidateSince[i] = now;
    } else if (readingOccupied != stableOccupied[i] &&
               now - candidateSince[i] >= DEBOUNCE_MS) {
      stableOccupied[i] = readingOccupied;
      reportSeat(i, stableOccupied[i]);
    }
  }

  // Refresh backend timestamps even when occupancy has not changed. This
  // lets the website distinguish live readings from stale last-known data.
  if (now - lastSensorHeartbeat >= SENSOR_HEARTBEAT_MS) {
    lastSensorHeartbeat = now;
    for (uint8_t i = 0; i < ONLINE_SENSOR_COUNT; ++i) {
      reportSeat(i, stableOccupied[i]);
    }
  }
}

