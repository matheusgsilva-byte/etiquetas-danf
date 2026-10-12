/**
 * Planos e limites de uso. Os valores podem ser ajustados aqui sem mudar o banco.
 * O pagamento não é obrigatório nesta versão: a troca de plano pode ser
 * liberada com ALLOW_PLAN_SELF_SERVICE=true (desenvolvimento/testes) ou feita
 * diretamente no banco por um administrador.
 */
export type PlanId = "FREE" | "PRO" | "ENTERPRISE";

export interface PlanLimits {
  name: string;
  priceLabel: string;
  description: string;
  maxFilesPerBatch: number;
  maxFileSizeMb: number;
  maxPagesPerBatch: number;
  monthlyLabels: number;
  storageMb: number;
  maxRetentionDays: number;
  maxMembers: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  FREE: {
    name: "Gratuito",
    priceLabel: "R$ 0",
    description: "Para começar e testar com poucos pedidos.",
    maxFilesPerBatch: 20,
    maxFileSizeMb: 10,
    maxPagesPerBatch: 100,
    monthlyLabels: 300,
    storageMb: 200,
    maxRetentionDays: 7,
    maxMembers: 1,
  },
  PRO: {
    name: "Profissional",
    priceLabel: "Sob consulta",
    description: "Maior volume de processamento e histórico ampliado.",
    maxFilesPerBatch: 200,
    maxFileSizeMb: 25,
    maxPagesPerBatch: 2000,
    monthlyLabels: 10_000,
    storageMb: 5_000,
    maxRetentionDays: 90,
    maxMembers: 3,
  },
  ENTERPRISE: {
    name: "Empresarial",
    priceLabel: "Sob consulta",
    description: "Limites elevados, múltiplos usuários e gestão de equipe.",
    maxFilesPerBatch: 1000,
    maxFileSizeMb: 50,
    maxPagesPerBatch: 10_000,
    monthlyLabels: 200_000,
    storageMb: 50_000,
    maxRetentionDays: 365,
    maxMembers: 50,
  },
};

export function planLimits(plan: string): PlanLimits {
  return PLANS[(plan as PlanId) in PLANS ? (plan as PlanId) : "FREE"];
}

export const MB = 1024 * 1024;
