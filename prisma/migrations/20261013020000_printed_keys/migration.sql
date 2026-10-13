-- Detalhe da duplicidade exibido no cartão da etiqueta
ALTER TABLE "Label" ADD COLUMN "duplicateNote" TEXT;

-- Chaves de DANFE já impressas (permanente, independente da retenção dos lotes)
CREATE TABLE "PrintedKey" (
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "batchName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrintedKey_pkey" PRIMARY KEY ("orgId","key")
);
ALTER TABLE "PrintedKey" ADD CONSTRAINT "PrintedKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A chave da DANFE passa a ter prefixo próprio (antes era tratada como rastreio)
UPDATE "Label" SET "shipmentKey" = 'nfe:' || substring("shipmentKey" from 8)
WHERE "shipmentKey" LIKE 'trk:NFE%' AND length("shipmentKey") = 51;

-- Histórico: DANFEs que já saíram em PDFs gerados (a primeira impressão vale)
INSERT INTO "PrintedKey" ("orgId", "key", "batchId", "batchName", "jobId", "printedAt")
SELECT DISTINCT ON (j."orgId", l."shipmentKey")
       j."orgId", l."shipmentKey", b."id", b."name", j."id", j."finishedAt"
FROM "Label" l
JOIN "Batch" b ON b."id" = l."batchId"
JOIN "Job" j ON j."batchId" = b."id" AND j."status" = 'COMPLETED' AND j."finishedAt" IS NOT NULL
WHERE l."shipmentKey" LIKE 'nfe:%' AND l."excluded" = false
ORDER BY j."orgId", l."shipmentKey", j."finishedAt" ASC
ON CONFLICT DO NOTHING;
