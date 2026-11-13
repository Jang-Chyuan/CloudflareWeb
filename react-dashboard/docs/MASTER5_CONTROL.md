# Master 5 remote control

The tracking/sleep buttons, command status polling, map mode source and control
authorization use Master 5 for Slaves 102/104/108. Users need device_members
membership for master_5. Master201-only membership does not grant Master5 access.

Apply supabase/migrations/202611090001_master5_control.sql AFTER the existing
device_commands migrations. It retains Master201 rows/RPC support and permissions.
Deploy poll-device-command and report-device-command with distinct
MASTER_5_DEVICE_TOKEN and MASTER_201_DEVICE_TOKEN secrets. Tokens bind to their
Master ID; duplicate token configuration is rejected. Never copy Master201's token
into Master5. The same deployment files are included in the Master5 repository.

Flash the updated Slave102/104/108 firmware: both Master IDs are accepted; ACK and
health responses address the requesting Master. Duplicate commands are scoped by
Master ID plus command ID, including RTC/deep-sleep replay.

No firmware flashing or cloud deployment is performed by these source changes.
Master5's observed TLS/allocation failure remains a separate runtime blocker.

## Master selector

Tracking/sleep controls offer Master5, Master201, and both. Only authorized
Masters are enabled; both requires membership in both. Each selected Master gets
a separate RPC with a separate request UUID. Ambiguous failure retries retain
that Master's UUID and never resend the successful channel. Polling/results are
independent. In-flight commands block switching and opposing commands.

## Cloud deployment status (2026-11-09)

The Master5/201 command migration and both command Edge Functions have now been
deployed to dog-gps. Both existing device tokens matched firmware and were kept
unchanged. COM10 Master5 polling now returns HTTP200 after verified TLS; status
uploads also return HTTP200. This deployment did not publish the website or
flash the Slaves. See C:/Dog_gps/dogLora_Master_5/docs/MASTER5_CLOUD_AUTH_FIX.md.

Slave 4/6: tracking and sleep use Master 5 only. Apply migration `202611130001_slave4_6_control.sql` before publishing the updated frontend. Master 201 retains its existing Slave 8/102/104/108 targets. Firmware must be flashed separately.
