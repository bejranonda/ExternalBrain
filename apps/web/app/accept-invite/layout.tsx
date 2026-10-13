import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getServerT } from "@/lib/brain/i18n-server";

// The page is a client component (it reads ?token= with useSearchParams), and
// a client module cannot export metadata — so its title lives here.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: `${t("auth.inviteTitle")} — External Brain`,
    description: t("meta.inviteDescription"),
  };
}

export default function AcceptInviteLayout({ children }: { children: ReactNode }) {
  return children;
}
