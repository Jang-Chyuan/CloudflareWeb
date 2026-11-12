export const COMMAND_FIELDS = 'id,master_id,slave_id,action,status,created_at,expires_at,completed_at,reported_mode,error_code,request_id';
export const controlMasters = authorized => [5, 201].filter(id => authorized.includes(id));
// Control ownership is independent of the Master forwarding the latest GPS.
export function modeMasterId(dog, authorizedMasters) {
  return [8, 102, 104, 108].includes(dog.id) ? controlMasters(authorizedMasters)[0] ?? dog.masterId : dog.masterId;
}
export const pendingCommand = command => command && ['queued', 'claimed'].includes(command.status);
export function commandLabel(command, now = Date.now()) {
  if (!command) return '尚未送出命令';
  const action = command.action === 'tracking' ? '追蹤' : '待機';
  if (['queued', 'claimed'].includes(command.status) && Date.parse(command.expires_at) <= now)
    return '未收到確認，裝置模式未知';
  return ({ queued: action + '命令已送出，等待裝置確認', claimed: action + '命令已送出，等待裝置確認',
    confirmed: command.action === 'tracking' ? '裝置已回覆追蹤命令' : '裝置已回覆省電命令', rejected: '裝置回報命令失敗，裝置模式未知',
    unconfirmed: '未收到確認，裝置模式未知', expired: '未收到確認，裝置模式未知',
    superseded: '命令已被較新的命令取代' })[command.status] || '命令狀態未知';
}
export function deviceMode(command) {
  const timestamp = command?.completed_at;
  if (command?.status !== 'confirmed' || ![0, 1].includes(command.reported_mode)
      || typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)))
    return { label: '未知', tracking: false, confirmedAt: null };
  return { label: command.reported_mode === 1 ? '追蹤中' : '省電待機',
    tracking: command.reported_mode === 1, confirmedAt: timestamp };
}
export async function createDeviceCommand(client, action, requestId, slaveId = 102, masterId = 5) {
  if (![5,201].includes(masterId)) throw new Error('Unsupported Master');
  if (![8,102,104,108].includes(slaveId)) throw new Error('不支援的裝置');
  if (!['tracking', 'sleep'].includes(action)) throw new Error('不支援的命令');
  const { data, error } = await client.rpc('create_device_command', {
    p_master_id: masterId, p_slave_id: slaveId, p_action: action, p_request_id: requestId,
  });
  if (error) throw error;
  if (!data?.id) throw new Error('命令回應不完整');
  return data;
}
export async function fetchLatestCommand(client, signal, masterId = 5, slaveId = 102) {
  const { data, error } = await client.from('device_commands').select(COMMAND_FIELDS)
    .eq('master_id', masterId).eq('slave_id', slaveId).order('created_at', { ascending: false })
    .order('id', { ascending: false }).limit(1).abortSignal(signal);
  if (error) throw error;
  return data?.[0] ?? null;
}

// Resolve device observations across authorized controllers; retain the last
// confirmation explicitly when a newer request or a read failure adds uncertainty.
export function resolveModeStatus(dog, authorizedMasters, states) {
  const ids = [8,102,104,108].includes(dog.id) && controlMasters(authorizedMasters).length
    ? controlMasters(authorizedMasters) : [dog.masterId];
  const channels = ids.map(id => states[`${id}:${dog.id}`]);
  const valid = c => c && ids.includes(c.master_id) && c.slave_id === dog.id;
  const time = c => Date.parse(c?.completed_at) || 0;
  const confirmations = channels.flatMap(c => [c?.command,c?.confirmed]).filter(c =>
    valid(c) && c.status === 'confirmed' && [0,1].includes(c.reported_mode) && time(c));
  confirmations.sort((a,b) => time(b)-time(a));
  const command = confirmations[0];
  if (!command) {
    const latest = channels.map(c=>c?.command).filter(valid).sort((a,b)=>
      (Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0))[0] ?? null;
    return {command:latest,ready:channels.every(c=>c?.ready),masterId:latest?.master_id ?? ids[0]};
  }
  if (confirmations.some(c=>time(c)===time(command) && c.reported_mode!==command.reported_mode))
    return {command:null,ready:true,masterId:ids[0]};
  const newerUnconfirmed = channels.some(c => valid(c?.command) &&
    !['confirmed','superseded'].includes(c.command.status) &&
    (Date.parse(c.command.created_at)||0) > (Date.parse(command.created_at)||time(command)));
  return {command,masterId:command.master_id,ready:channels.every(c=>c?.ready) && !newerUnconfirmed};
}

export async function fetchLatestConfirmedCommand(client, signal, masterId, slaveId) {
  const {data,error} = await client.from('device_commands').select(COMMAND_FIELDS)
    .eq('master_id',masterId).eq('slave_id',slaveId).eq('status','confirmed')
    .order('completed_at',{ascending:false}).order('id',{ascending:false}).limit(1).abortSignal(signal);
  if(error) throw error;
  return data?.[0] ?? null;
}
