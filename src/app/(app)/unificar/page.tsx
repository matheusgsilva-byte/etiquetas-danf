import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResumeList } from "@/components/unify/resume-list";
import { Workspace } from "@/components/unify/workspace";
import { getSession } from "@/lib/auth/session";
import { planLimits } from "@/lib/plans";

export const metadata: Metadata = { title: "Nova unificação" };

export default async function NewUnificationPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Workspace initialBatchId={null} limits={planLimits(session.org.plan)} emptyExtra={<ResumeList />} />;
}
