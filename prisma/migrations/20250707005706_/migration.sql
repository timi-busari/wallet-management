-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "reference_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_reference_id_idx" ON "transactions"("reference_id");
