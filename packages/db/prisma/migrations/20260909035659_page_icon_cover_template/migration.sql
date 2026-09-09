-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Page_spaceId_isTemplate_idx" ON "Page"("spaceId", "isTemplate");
