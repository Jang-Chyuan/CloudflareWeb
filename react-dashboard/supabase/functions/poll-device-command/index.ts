import { deviceCommandHandler } from '../_shared/device-command.ts';
Deno.serve(deviceCommandHandler(false));
