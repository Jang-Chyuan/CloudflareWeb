#include "core/CommandTrace.h"
#include "CloudCommandTask.h"
#include "../core/HttpsTransport.h"
#include "../core/ClockSync.h"
#include "../LoRa/RemoteControl.h"
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <time.h>
#include <ctype.h>
#if __has_include("config/supabase_local.h")
#include "config/supabase_local.h"
#else
#include "config/supabase_local.example.h"
#endif

#if SUPABASE_ENABLED
namespace {
struct Journal {
    uint32_t version, radioId, expiresAt;
    char id[37], claim[37];
    uint8_t op, stage, outcome, mode, slaveId;
};
static_assert(sizeof(Journal) == 92 && offsetof(Journal, slaveId) == 90,
              "NVS v1 migration requires unchanged field offsets and size");
// stage 1: execution may have started; stage 2: result awaiting upload.
Preferences storage;
bool save(const Journal &j) { return storage.putBytes("pending", &j, sizeof(j)) == sizeof(j); }
String endpoint(const char *name) {
    String url(SUPABASE_FUNCTION_URL);
    if (strcmp(name, "poll-device-command") == 0) {
        const int functions = url.indexOf("/functions/v1/");
        return url.substring(0, functions) + "/rest/v1/rpc/poll_device_command_rest";
    }
    const int slash = url.lastIndexOf('/');
    return url.substring(0, slash + 1) + name;
}
int post(const char *name, const String &body, String &response) {
    HttpsRequestGuard guard;
    if (!guard) return HTTPS_DEFERRED;
    int code = -1;
    {
        WiFiClientSecure client;
        client.setCACert(SUPABASE_ROOT_CA);
        client.setHandshakeTimeout(15);
        HTTPClient http;
        http.setConnectTimeout(10000); http.setTimeout(10000);
        if (http.begin(client, endpoint(name))) {
            http.addHeader("Content-Type", "application/json");
            if (strcmp(name, "poll-device-command") == 0)
                http.addHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
            http.addHeader("X-Device-Token", SUPABASE_DEVICE_TOKEN);
            code = http.POST(body);
            if (code == 200) response = http.getString();
            http.end();
        }
        if (code < 0) {
            httpsLogMemory("cloud-tls-failure");
            char detail[160]{};
            const int tlsError = client.lastError(detail, sizeof(detail));
            Serial.printf("[CLOUD] %s transport=%d TLS=%d (%s)\n", name, code, tlsError, detail);
        }
    }
    guard.finish(code, name);
    return code;
}
bool uuid(const char *s) {
    if (!s || strlen(s) != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (s[i] != '-') return false; }
        else if (!isxdigit(static_cast<unsigned char>(s[i]))) return false;
    }
    return true;
}
void task(void *) {
    Journal j{};
    if (storage.getBytesLength("pending") == sizeof(j)) storage.getBytes("pending", &j, sizeof(j));
    if (j.version == 1) {
        j.version = 2; j.slaveId = 102;
        if (!save(j)) { Serial.println("[CLOUD] Journal migration failed"); vTaskDelete(nullptr); return; }
    }
    if (j.version == 2 && j.stage == 1) {
        // A reboot cannot establish whether Slave executed: report uncertainty, never replay.
        commandTraceRecord("cloud_reboot_pending", j.radioId, j.op);
        j.stage = 2; j.outcome = uint8_t(RemoteOutcome::Unconfirmed); j.mode = 255;
        if (!save(j)) { Serial.println("[CLOUD] Journal recovery failed; task stopped"); vTaskDelete(nullptr); return; }
    }
    bool waiting = false;
    bool resultSaved = false;
    uint32_t nextPoll = 0;
    uint32_t failureDelay = 2000;
    auto retryLater = [&]() {
        nextPoll = millis() + failureDelay;
        failureDelay = failureDelay < 30000 ? failureDelay * 2 : 60000;
    };
    for (;;) {
        if (waiting) {
            RemoteResult result{};
            if (receiveCloudResult(result) && result.commandId == j.radioId && result.slaveId == j.slaveId) {
                j.stage = 2; j.outcome = uint8_t(result.outcome); j.mode = result.mode;
                waiting = false;
            }
        }
        if (j.stage == 2 && !resultSaved) {
            if (!save(j)) {
                Serial.println("[CLOUD] Cannot persist result; retrying");
                vTaskDelay(pdMS_TO_TICKS(5000)); continue;
            }
            resultSaved = true;
        }
        if (!clockSyncReady() || waiting) {
            vTaskDelay(pdMS_TO_TICKS(100)); continue;
        }
        if (static_cast<int32_t>(millis() - nextPoll) < 0) { vTaskDelay(pdMS_TO_TICKS(100)); continue; }
        nextPoll = millis() + (j.stage == 2 ? 5000 : 1000);
        String response;
        if (j.stage == 2) {
            const char *outcomes[]{"confirmed", "rejected", "unconfirmed", "expired"};
            JsonDocument body;
            body["id"] = j.id; body["claim_token"] = j.claim;
            body["radio_command_id"] = j.radioId;
            body["outcome"] = outcomes[j.outcome < 4 ? j.outcome : 2];
            if (j.mode <= 1) body["reported_mode"] = j.mode;
            String payload; serializeJson(body, payload);
            const int code = post("report-device-command", payload, response);
            if (code == HTTPS_DEFERRED) continue;
            commandTraceRecord("cloud_report", j.radioId, j.op, code, j.mode, j.outcome);
            Serial.printf("[CLOUD] Report radio=%lu HTTP=%d\n", (unsigned long)j.radioId, code);
            if (code == 200 || code == 409) {
                failureDelay = 2000;
                if (code == 409) Serial.println("[CLOUD] Result conflicts with terminal cloud state; no replay");
                if (storage.remove("pending")) { j = {}; resultSaved = false; }
            } else retryLater();
            continue;
        }
        const int code = post("poll-device-command", "{}", response);
        if (code == HTTPS_DEFERRED) continue;
        if (code != 200) { Serial.printf("[CLOUD] Poll HTTP=%d\n", code); retryLater(); continue; }
        JsonDocument doc;
        if (deserializeJson(doc, response)) { Serial.println("[CLOUD] Invalid poll JSON"); retryLater(); continue; }
        failureDelay = 2000;
        if (doc["command"].isNull()) continue;
        JsonObjectConst c = doc["command"].as<JsonObjectConst>();
        const char *id = c["id"] | "", *claim = c["claim_token"] | "";
        const char *action = c["action"] | "";
        const uint64_t radio = c["radio_command_id"] | uint64_t(0);
        const uint32_t expiresAt = c["expires_at_epoch"] | uint32_t(0);
        if (!uuid(id) || !uuid(claim) || c["master_id"].as<int>() != LORA_MASTER_DEVICE_ID || !isRemoteSlave(c["slave_id"].as<int>()) ||
            !radio || radio > 0x7fffffffULL || !expiresAt ||
            (strcmp(action, "tracking") && strcmp(action, "sleep"))) {
            Serial.println("[CLOUD] Rejected invalid command response"); continue;
        }
        j = {}; j.version = 2; j.slaveId = c["slave_id"].as<uint8_t>(); j.radioId = uint32_t(radio); j.expiresAt = expiresAt;
        strlcpy(j.id, id, sizeof(j.id)); strlcpy(j.claim, claim, sizeof(j.claim));
        j.op = !strcmp(action, "tracking") ? COMMAND_WAKE : COMMAND_SLEEP;
        commandTraceRecord("cloud_claim", j.radioId, j.op);
        j.stage = 1; j.mode = 255;
        if (!save(j)) { Serial.println("[CLOUD] Cannot persist command; refusing LoRa execution"); j = {}; continue; }
        Serial.printf("[CLOUD] Claimed %s slave=%u radio=%lu\n", action, j.slaveId, (unsigned long)j.radioId);
        const time_t now = time(nullptr);
        Serial.printf("[CLOUD] Deadline radio=%lu now_epoch=%lld expires_epoch=%lu remaining_s=%lld\n",
                      (unsigned long)j.radioId, int64_t(now), (unsigned long)j.expiresAt,
                      int64_t(j.expiresAt) - int64_t(now));
        if (now >= j.expiresAt) {
            j.stage = 2; j.outcome = uint8_t(RemoteOutcome::Expired);
        } else if (sendCloudCommand(j.slaveId, j.op, j.radioId, j.expiresAt)) waiting = true;
        else { j.stage = 2; j.outcome = uint8_t(RemoteOutcome::Rejected); }
    }
}
}
#endif
bool cloudCommandTaskInit() {
#if SUPABASE_ENABLED
    if (strlen(SUPABASE_PUBLISHABLE_KEY) == 0 || strlen(SUPABASE_DEVICE_TOKEN) < 32 || !strstr(SUPABASE_FUNCTION_URL, "/functions/v1/") ||
        strncmp(SUPABASE_FUNCTION_URL, "https://", 8) || strstr(SUPABASE_FUNCTION_URL, "YOUR_PROJECT") ||
        !strstr(SUPABASE_ROOT_CA, "-----BEGIN CERTIFICATE-----") || strstr(SUPABASE_ROOT_CA, "PASTE_ROOT_CA")) return false;
    if (!storage.begin("cloudcmd", false)) return false;
    if (xTaskCreatePinnedToCore(task, "CloudCommand", 8192, nullptr, 1, nullptr, 0) != pdPASS) return false;
    Serial.println("[CLOUD] Command poll ready (1s)");
#endif
    return true;
}
