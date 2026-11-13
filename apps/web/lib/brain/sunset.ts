/**
 * Web-side reading of the service sunset (docs/SUNSET.md). SERVER ONLY.
 *
 * While a sunset is configured no new account can be created — by any path:
 * registration, voucher, invite or a first GitHub sign-in. A user who joins a
 * closing instance only to lose the account weeks later is the one outcome a
 * notice period exists to prevent.
 */
import { serviceSunset } from "@brain/core/sunset";

export function signupsClosed(): boolean {
  return serviceSunset() !== null;
}
