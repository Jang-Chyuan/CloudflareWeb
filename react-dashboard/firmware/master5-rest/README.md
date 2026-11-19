# Master 5 REST polling

Prepared source; not deployed or flashed. `CloudCommandTask.cpp` is based on
`C:/Dog_gps/dogLora_Master_5/src/tasks/CloudCommandTask.cpp`.

Only polling moves to REST. Result reporting keeps the existing Edge Function,
including HTTP 409 handling, NVS journal and replay protection.

## Deploy in order

1. Apply only `supabase/migrations/202611160001_device_rest_poll.sql` after the
   existing command migrations. Do not push unrelated pending migrations.
2. Register a SHA-256 digest of each existing Master's device token in
   `device_private.command_credentials`. Use the exact UTF-8 token with no newline.
   Generate the digest locally; do not paste the raw token into SQL history.
   Each Master must have its own token. Example with placeholders (replace digest):

   ```sql
   insert into device_private.command_credentials(master_id,token_sha256)
   values (5,'REPLACE_WITH_64_LOWERCASE_HEX_DIGEST')
   on conflict (master_id) do update
     set token_sha256=excluded.token_sha256, enabled=true;
   ```

3. Run `tests/device-rest-poll.rollback.sql` as postgres against a test database.
   It temporarily stubs the existing claim RPC inside a rolled-back transaction
   to verify authorization without consuming actual commands.
4. Add `#define SUPABASE_PUBLISHABLE_KEY "sb_publishable_..."` to the firmware's
   local config. Use the project's publishable key, never a secret/service key.
   Keep the existing device token, function URL and CA certificate.
5. Copy the prepared `.cpp` into the Master 5 firmware's `src/tasks/`, compile with
   its existing PlatformIO environment, and flash the intended Master.
6. Verify poll HTTP 200 and `{"command":null}` with no pending commands. An invalid
   device token must return HTTP 401. Then test tracking/sleep and result reporting.
   Polling should stop adding invocations to the poll Edge Function.

The new request is POST `/rest/v1/rpc/poll_device_command_rest`, body `{}`, headers
`apikey: <publishable key>`, `X-Device-Token: <existing device token>` and
`Content-Type: application/json`. No Auth login/JWT is required for this custom
device-token flow. The database binds the credential to its Master; callers cannot
supply a Master ID. Credentials live in a non-exposed schema with no client grants.
Do not add `device_private` to Data API exposed schemas.

The existing atomic claim RPC still owns locking, leases, expiry and superseding.
Existing Edge polling remains usable for rollback. To roll back firmware, restore
the prior `.cpp`; do not remove the original cloud function or its device secrets.
Master 201 firmware must be adapted separately before its calls stop using Edge.
REST polling still consumes database resources and network transfer.

Implementation references:
- https://supabase.com/docs/guides/api
- https://postgrest.org/en/stable/references/transactions.html
