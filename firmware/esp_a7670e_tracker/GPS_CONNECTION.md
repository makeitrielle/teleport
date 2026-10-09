# Connecting the GPS tracker

Open esp_a7670e_tracker.ino and upload it to the LilyGO T-A7670 ESP32 board.
Use ESP32 Dev Module, PSRAM Enabled, Huge APP partition, and Serial Monitor at 115200 baud.
Install the TinyGSM fork supplied with LilyGo-Modem-Series, plus ArduinoJson.

Keep your working Wi-Fi configuration. Keep your existing device_config.h if you have one on the computer used to upload. This checkout does not contain that private file. If needed, copy device_config.example.h to device_config.h and set the actual administrator-issued device key and trusted PEM root certificate for the backend. Never commit credentials or disable HTTPS verification.

Attach the GPS antenna to the GNSS connector and place it outdoors with a clear view of the sky. Some A7670 variants do not contain built-in GNSS; check the printed modem model if enabling GNSS still fails.

Expected messages: GPS enabled, GPS fix, Bus update sent. A fix may take several minutes after a cold start. Wi-Fi alone does not establish GPS positioning.

For HTTP 400, the updated sketch prints an API error line identifying the rejection. The seat payload must contain busId, numeric seatId, and status available/booked, or sensor fault. The current sketch sends this format; the earlier status-only log cannot establish which validation failed. HTTP 401 means the key and configured bus identity need checking. Do not post device keys in logs.

Official board startup and GNSS example:
https://github.com/Xinyuan-LilyGO/LilyGo-Modem-Series/blob/main/examples/GPS_BuiltIn/GPS_BuiltIn.ino
