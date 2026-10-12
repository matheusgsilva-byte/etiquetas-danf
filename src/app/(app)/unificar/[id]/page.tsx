import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/unify/workspace";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { planLimits } from "@/lib/plans";

export const metadata: Metadata = { title: "Unificação" };

export default async function UnificationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const exists = await db.batch.findFirst({ where: { id, orgId: session.org.id }, select: { id: true } });
  if (!exists) notFound();
  return <Workspace key={id} initialBatchId={id} limits={planLimits(session.org.plan)} />;
}
