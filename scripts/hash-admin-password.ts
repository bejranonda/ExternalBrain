#!/usr/bin/env tsx
/**
 * hash-admin-password.ts
 *
 * Produce a bcrypt hash suitable for pasting into `.env` as the
 * `ADMIN_PASSWORD_HASH` value. Cost 12 matches the runtime verifier.
 *
 * Usage:
 *   pnpm hash-admin-password '<plaintext-password>'
 *
 * The password is read from argv[2] so it never touches a history file
 * via `$HISTFILE` when the operator wraps the shell invocation with a
 * leading space (or sets HISTCONTROL=ignorespace). A future improvement
 * is to read from stdin / a TTY prompt; for now this is simpler.
 *
 * The printed hash ends with a newline; paste it into `.env.local` like:
 *   ADMIN_PASSWORD_HASH='$2b$12$…'
 * (single quotes — bcrypt hashes contain `$` characters that bash would
 * otherwise try to expand).
 */
import bcrypt from "bcryptjs";

async function main(): Promise<void> {
  const plaintext = process.argv[2];
  if (!plaintext) {
    console.error("usage: pnpm hash-admin-password '<plaintext-password>'");
    console.error("");
    console.error("Tip: prepend a space to the command so it's not stored in");
    console.error("shell history (requires HISTCONTROL=ignorespace).");
    process.exit(1);
  }
  if (plaintext.length < 12) {
    console.error(
      "password must be at least 12 characters (bcrypt's effective brute-force floor).",
    );
    process.exit(2);
  }
  const hash = await bcrypt.hash(plaintext, 12);
  // Print the hash on its own line so a tool like `pbcopy` or `xclip`
  // can pick it up without the operator having to hand-trim.
  process.stdout.write(hash + "\n");
}

void main();
