#include <Arduino.h>
#include <DFRobotDFPlayerMini.h>

// Arduino Mega 2560: TX2 pin 16 -> 1k resistor -> player RX.
// Player TX -> Mega RX2 pin 17. See ../MP3_TF_16P.md for power/speaker wiring.
// This standalone test replaces the seat sketch while it is uploaded.
DFRobotDFPlayerMini player;
bool ready = false;

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600);
  delay(1500);  // Give the player and its microSD card time to start.
  ready = player.begin(Serial2, true, true);
  if (!ready) {
    Serial.println(F("Player not found. Check power, TX/RX wires, and microSD card. Then reset the Mega."));
    return;
  }
  player.setTimeOut(500);
  player.outputDevice(DFPLAYER_DEVICE_SD);
  player.volume(15);  // Start at half volume; range is 0-30.
  delay(500);
  Serial.println(F("Ready! Type 1, 2, or 3 to play a clip. Type s to stop."));
}

void loop() {
  if (ready && Serial.available()) {
    const char command = Serial.read();
    if (command >= '1' && command <= '3') {
      const uint16_t clip = command - '0';
      player.playMp3Folder(clip);
      Serial.print(F("Play command sent for /mp3/000"));
      Serial.print(clip);
      Serial.println(F(".mp3"));
    } else if (command == 's' || command == 'S') {
      player.stop();
      Serial.println(F("Stop command sent."));
    }
  }
  if (ready && player.available()) {
    const uint8_t type = player.readType();
    const int value = player.read();
    if (type == DFPlayerError) {
      Serial.print(F("Player error code: "));
      Serial.println(value);
    } else if (type == DFPlayerPlayFinished) {
      Serial.println(F("Clip finished."));
    }
  }
}
