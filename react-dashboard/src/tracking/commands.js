export const COMMAND_FIELDS = 'id,master_id,slave_id,action,status,created_at,expires_at,completed_at,reported_mode,error_code';
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
export async function createDeviceCommand(client, action, requestId) {
  if (!['tracking', 'sleep'].includes(action)) throw new Error('不支援的命令');
  const { data, error } = await client.rpc('create_device_command', {
    p_master_id: 201, p_slave_id: 102, p_action: action, p_request_id: requestId,
  });
  if (error) throw error;
  if (!data?.id) throw new Error('命令回應不完整');
  return data;
}
export async function fetchLatestCommand(client, signal, masterId = 201, slaveId = 102) {
  const { data, error } = await client.from('device_commands').select(COMMAND_FIELDS)
    .eq('master_id', masterId).eq('slave_id', slaveId).order('created_at', { ascending: false })
    .order('id', { ascending: false }).limit(1).abortSignal(signal);
  if (error) throw error;
  return data?.[0] ?? null;
}
