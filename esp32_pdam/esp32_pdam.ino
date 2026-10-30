// ===== MONITORING PDAM - FLOW METER PULSA (LXLC-80) =====
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include <Preferences.h>

// ====== UBAH BAGIAN INI ======
const char* WIFI_SSID  = "ARSHAKA 4G";
const char* WIFI_PASS  = "arshaka01";
const char* SERVER_URL = "http://192.168.1.3:3000/api/data"; // IP laptop + :3000
const double LITER_PER_PULSE = 100.0;  // liter per 1 pulsa (ganti sesuai hasil kalibrasi)
const double OFFSET_M3 = 0.0;          // angka awal meteran (m3); selanjutnya diatur lewat tombol Reset
// =============================

#define FLOW_PIN 27   // kabel reed meter -> GPIO27, kabel reed satunya -> GND
#define BATT_PIN 34   // dari pembagi tegangan baterai

const float  DIVIDER = 4.03;           // R1=100k, R2=33k -> (100+33)/33

// ---- Pengaturan debit ----
const float  STOP_FACTOR  = 1.3;       // debit jadi 0 bila pulsa telat > 1.3x jarak pulsa sebelumnya
const unsigned long MIN_WAIT_MS = 10000;   // minimal menunggu 10 detik sebelum dianggap berhenti
const unsigned long NOFLOW_MS   = 900000;  // batas maksimal menunggu 15 menit
const double MAX_FLOW_LPM = 1300.0;    // debit maksimum meter (L/menit)

const unsigned long SEND_MS = 5000;    // kirim ke server tiap 5 detik
const unsigned long SAVE_MS = 30000;   // simpan total ke memori maksimal tiap 30 detik

volatile unsigned long pulseCount  = 0;
volatile unsigned long lastPulseMs = 0;
volatile unsigned long intervalMs  = 0;
volatile unsigned long debounceMs  = 1000;
unsigned long totalPulses = 0;
unsigned long lastSend = 0, lastSave = 0;
double offsetM3 = 0;
bool dirty = false;
Preferences prefs;

void IRAM_ATTR onPulse() {
  unsigned long now = millis();
  if (now - lastPulseMs < debounceMs) return;
  if (lastPulseMs != 0) intervalMs = now - lastPulseMs;
  lastPulseMs = now;
  pulseCount++;
}

// Debit (L/menit): dari jarak 2 pulsa terakhir, langsung 0 bila pulsa berikutnya telat
float calcFlow() {
  noInterrupts();
  unsigned long last = lastPulseMs, iv = intervalMs;
  interrupts();
  if (last == 0 || iv == 0) return 0;

  unsigned long since = millis() - last;
  unsigned long limit = (unsigned long)(iv * STOP_FACTOR);
  if (limit < MIN_WAIT_MS) limit = MIN_WAIT_MS;
  if (limit > NOFLOW_MS)   limit = NOFLOW_MS;

  if (since > limit) {
    noInterrupts();
    lastPulseMs = 0;
    intervalMs  = 0;
    interrupts();
    return 0;
  }
  return LITER_PER_PULSE / (iv / 60000.0);
}

// Reset total (perintah dari tombol Reset di dashboard)
void doReset(double newOffsetM3) {
  noInterrupts();
  pulseCount = 0; lastPulseMs = 0; intervalMs = 0;
  interrupts();
  totalPulses = 0;
  offsetM3 = newOffsetM3;
  dirty = false;
  prefs.putULong("pulses", 0);
  prefs.putDouble("offset", offsetM3);
  Serial.printf("RESET dari dashboard. Mulai dari %.3f m3\n", offsetM3);
}

float readBattery() {
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(BATT_PIN);
  return (mv / 16.0 / 1000.0) * DIVIDER;
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Menghubungkan WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.print("\nTerhubung. IP ESP32: ");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(115200);

  // Anti-pantulan otomatis: seperempat dari jarak pulsa tercepat meter (10 - 1000 ms)
  double minIntervalMs = LITER_PER_PULSE / MAX_FLOW_LPM * 60000.0;
  unsigned long d = (unsigned long)(minIntervalMs / 4.0);
  if (d > 1000) d = 1000;
  if (d < 10)   d = 10;
  debounceMs = d;
  Serial.printf("Anti-pantulan: %lu ms\n", d);

  prefs.begin("pdam", false);
  totalPulses = prefs.getULong("pulses", 0);          // total tidak hilang saat ESP32 mati
  offsetM3    = prefs.getDouble("offset", OFFSET_M3);

  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), onPulse, FALLING);
  analogSetPinAttenuation(BATT_PIN, ADC_11db);
  connectWiFi();
  configTime(7 * 3600, 0, "pool.ntp.org");  // WIB
  lastSend = millis();
  lastSave = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  if (millis() - lastSend >= SEND_MS) {
    lastSend = millis();

    noInterrupts();
    unsigned long p = pulseCount;
    pulseCount = 0;
    interrupts();

    if (p > 0) { totalPulses += p; dirty = true; }
    if (dirty && millis() - lastSave >= SAVE_MS) {
      prefs.putULong("pulses", totalPulses);
      lastSave = millis();
      dirty = false;
    }

    float  flow  = calcFlow();                                          // L/menit
    double total = offsetM3 * 1000.0 + totalPulses * LITER_PER_PULSE;   // liter
    float  batt  = readBattery();

    char waktu[24] = "-";
    struct tm t;
    if (getLocalTime(&t, 200)) strftime(waktu, sizeof(waktu), "%Y-%m-%d %H:%M:%S", &t);

    char json[220];
    snprintf(json, sizeof(json),
      "{\"flow\":%.2f,\"total\":%.2f,\"pulse\":%lu,\"battery\":%.2f,\"time\":\"%s\"}",
      flow, total, totalPulses, batt, waktu);

    HTTPClient http;
    http.setConnectTimeout(3000);
    http.setTimeout(4000);
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(json);
    Serial.printf("%s -> HTTP %d\n", json, code);

    if (code == 200) {                                   // cek perintah reset dari server
      String r = http.getString();
      if (r.indexOf("\"reset\":true") >= 0) {
        int i = r.indexOf("\"offset\":");
        doReset(i >= 0 ? r.substring(i + 9).toDouble() : 0.0);
      }
    }
    http.end();
  }
}
