-- Voucher-code registration (Phase S2, 2026-04-23).
-- Gates new-user signups behind an invite code. An admin issues codes via
-- the admin UI; `auth.ts::signIn` validates the cookie-stored code against
-- this table atomically via `claimVoucher()` in lib/brain/vouchers.ts.

CREATE TABLE "VoucherCode" (
    "id"                TEXT         NOT NULL,
    "code"              TEXT         NOT NULL,
    "kind"              TEXT         NOT NULL,
    "organizationLabel" TEXT,
    "maxUses"           INTEGER      NOT NULL DEFAULT 1,
    "usedCount"         INTEGER      NOT NULL DEFAULT 0,
    "expiresAt"         TIMESTAMP(3),
    "disabled"          BOOLEAN      NOT NULL DEFAULT false,
    "note"              TEXT,
    "createdByUserId"   TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoucherCode_code_key" ON "VoucherCode"("code");
CREATE INDEX "VoucherCode_disabled_expiresAt_idx" ON "VoucherCode"("disabled", "expiresAt");
CREATE INDEX "VoucherCode_kind_idx" ON "VoucherCode"("kind");

CREATE TABLE "VoucherRedemption" (
    "id"          TEXT         NOT NULL,
    "voucherId"   TEXT         NOT NULL,
    "userId"      TEXT         NOT NULL,
    "redeemedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoucherRedemption_userId_key" ON "VoucherRedemption"("userId");
CREATE INDEX "VoucherRedemption_voucherId_redeemedAt_idx" ON "VoucherRedemption"("voucherId", "redeemedAt");

ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "VoucherCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
