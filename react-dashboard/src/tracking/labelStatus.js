// GPS and dog names are resolved separately. Keep status fields from one report.
export function labelMode(dog) {
  if (!dog.modeStatus?.ready) {
    const previous = dog.modeStatus?.command;
    if (previous?.status !== 'confirmed') return '未知';
    const lastMode = labelMode({ ...dog, healthDisplay: null, modeStatus: { ...dog.modeStatus, ready: true, command: previous } });
    return lastMode === '未知' ? lastMode : `${lastMode}（上次確認）`;
  }
  const command = dog.modeStatus.command;
  const commandMasterId = dog.modeStatus.masterId ?? dog.masterId;
  const commandMatches = command?.master_id === commandMasterId && command?.slave_id === dog.id;
  const health = dog.healthDisplay;
  const healthAt = Date.parse(health?.received_at);
  const healthMatches = health?.master_id === dog.masterId && health?.slave_id === dog.id;
  const commandAt = commandMatches ? Math.max(Date.parse(command?.created_at) || 0, Date.parse(command?.completed_at) || 0) : 0;
  if (healthMatches && Number.isFinite(healthAt) && healthAt > commandAt && [0, 1].includes(health.mode)) {
    return health.mode === 1 ? '追蹤中' : '省電待機';
  }
  if (commandMatches
      && command.status === 'confirmed' && Number.isFinite(Date.parse(command.completed_at))
      && [0, 1].includes(command.reported_mode)) {
    return command.reported_mode === 1 ? '追蹤中' : '省電待機';
  }
  return '未知';
}

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
