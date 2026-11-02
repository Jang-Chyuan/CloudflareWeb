// GPS and dog names are resolved separately. Keep status fields from one report.
export function labelStatus(dog) {
  const health = dog.healthDisplay;
  const telemetryAt = dog.packet?.received_at;
  const healthAt = Date.parse(health?.received_at);
  const matchingHealth = health?.master_id === dog.masterId && health?.slave_id === dog.id;
  if (matchingHealth && Number.isFinite(healthAt)
      && (!Number.isFinite(telemetryAt) || healthAt > telemetryAt)) {
    return { source: 'dog_health', packetAt: healthAt,
      battery: health.battery_valid === true || health.battery_valid === 1 ? health.battery_pct : null,
      rssi: health.rssi };
  }
  return { source: 'dog_telemetry', packetAt: dog.lastPacketAt,
    battery: dog.battery, rssi: dog.packet?.rssi };
}
