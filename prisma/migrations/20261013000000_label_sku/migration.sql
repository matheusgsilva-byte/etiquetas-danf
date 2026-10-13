-- SKU impresso na etiqueta (ordenação por SKU)
ALTER TABLE "Label" ADD COLUMN "sku" TEXT;
ALTER TABLE "Label" ADD COLUMN "skuKey" TEXT;
