import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResumeList } from "@/components/unify/resume-list";
import { Workspace } from "@/components/unify/workspace";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nova unificação" };

export default async function NewUnificationPage() {
  if (!(await getSession())) redirect("/login");
  return <Workspace initialBatchId={null} emptyExtra={<ResumeList />} />;
}
