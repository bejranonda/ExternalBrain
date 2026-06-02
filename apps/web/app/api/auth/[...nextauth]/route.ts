import { handlers } from "@/auth";

// Force dynamic — NextAuth's handlers open a DB connection to upsert the user
// on first sign-in. If Next's page-data collector evaluates this module at
// build time it trips Prisma's "not initialized yet" on the Alpine image.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = handlers;
