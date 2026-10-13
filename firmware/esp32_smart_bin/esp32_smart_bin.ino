/*
 * Smart Waste MIS — ESP32 smart-bin node
 * ─────────────────────────────────────────────────────────────────────
 * Hardware (per bin):
 *   - ESP32 DevKit (any WiFi-capable module)
 *   - HC-SR04 ultrasonic sensor mounted under the lid, facing down
 *       TRIG → GPIO 5,  ECHO → GPIO 18 (through a 5V→3.3V divider)
 *   - DS18B20 temperature probe on GPIO 4 (4.7k pull-up to 3.3V).
 *     Mount it inside the bin near the sensor, in the air the echo travels
 *     through — not on the board or in the sun-heated enclosure — because its
 *     reading also corrects the ultrasonic distance for temperature.
 *
 * Behaviour:
 *   - Every REPORT_INTERVAL_MS it measures the free distance under the lid,
 *     converts it to a fill percentage using the bin's internal height,
 *     reads the temperature, and POSTs one JSON reading to the server
 *     ingest route (/api/iot/readings) with its per-device key.
 *   - The server resolves which bin this device belongs to; the device
 *     never claims a bin id.
 *   - Out-of-range values are rejected by the server (422) — the sketch
 *     also clamps obviously-bad echoes locally and skips them.
 *
 * Libraries (Arduino IDE → Library Manager):
 *   - OneWire, DallasTemperature, ArduinoJson (v6+)
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ── Fill in per deployment ───────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* INGEST_URL    = "https://YOUR-VERCEL-APP.vercel.app/api/iot/readings";
const char* DEVICE_ID     = "DEV-الريان-01";      // must equal iot_devices.deviceId
const char* DEVICE_KEY    = "paste-the-key-shown-once-in-settings";  // never commit a real key
const float BIN_HEIGHT_CM = 90.0;   // internal height from sensor face to bin floor
const float SENSOR_DEAD_ZONE_CM = 3.0;
const unsigned long REPORT_INTERVAL_MS = 5UL * 60UL * 1000UL; // 5 minutes

// ── Pins ─────────────────────────────────────────────────────────────
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;
const int ONE_WIRE_PIN = 4;

OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature temps(&oneWire);

// Speed of sound in cm/µs for the air inside the bin. Sound travels faster in
// hot air (c ≈ 331.3 + 0.606·T m/s), so a fixed 20 °C constant makes a hot bin
// read fuller than it is — about +5 percentage points on an empty bin at 50 °C.
// Falls back to the 20 °C value when the probe is missing or reads implausibly.
float speedOfSoundCmPerUs(float tempC) {
  if (tempC < -20.0f || tempC > 85.0f) return 0.0343f;
  return (331.3f + 0.606f * tempC) / 10000.0f;
}

float measureDistanceCm(float tempC) {
  // Median of 5 echoes — single ultrasonic echoes off loose waste are noisy.
  const float soundCmPerUs = speedOfSoundCmPerUs(tempC);
  float samples[5];
  for (int i = 0; i < 5; i++) {
    digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30 ms timeout ≈ 5 m
    samples[i] = duration > 0 ? (duration * soundCmPerUs) / 2.0f : -1.0f;
    delay(60);
  }
  for (int i = 0; i < 5; i++) for (int j = i + 1; j < 5; j++) if (samples[j] < samples[i]) { float t = samples[i]; samples[i] = samples[j]; samples[j] = t; }
  return samples[2];
}

float fillPercentFromDistance(float distanceCm) {
  if (distanceCm < 0) return -1;
  float usable = BIN_HEIGHT_CM - SENSOR_DEAD_ZONE_CM;
  float filled = BIN_HEIGHT_CM - distanceCm;
  float pct = (filled / usable) * 100.0f;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) { delay(250); }
}

bool postReading(float fillPct, float tempC) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(INGEST_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["fill_level_percent"] = fillPct;
  if (tempC > -100) doc["temperature_celsius"] = tempC;
  doc["signal"] = WiFi.RSSI();
  String body; serializeJson(doc, body);

  int code = http.POST(body);
  Serial.printf("[ingest] HTTP %d — %s\n", code, http.getString().c_str());
  http.end();
  return code == 201;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  temps.begin();
  connectWiFi();
}

void loop() {
  connectWiFi();
  // Temperature first: the distance calculation needs it.
  temps.requestTemperatures();
  float tempC = temps.getTempCByIndex(0);
  if (tempC == DEVICE_DISCONNECTED_C) tempC = -127; // server treats missing temp as null
  float distance = measureDistanceCm(tempC);
  float fill = fillPercentFromDistance(distance);

  if (fill >= 0) {
    Serial.printf("distance=%.1fcm fill=%.0f%% temp=%.1fC\n", distance, fill, tempC);
    postReading(fill, tempC);
  } else {
    Serial.println("bad echo — skipping this cycle");
  }
  delay(REPORT_INTERVAL_MS);
}
