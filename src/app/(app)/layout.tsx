import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";
import { planLimits } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <AppShell user={session.user} orgName={session.org.name} planName={planLimits(session.org.plan).name}>
      {children}
    </AppShell>
  );
}
