-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailOnComment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailOnMention" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PageSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageSubscription_pageId_idx" ON "PageSubscription"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageSubscription_userId_pageId_key" ON "PageSubscription"("userId", "pageId");

-- AddForeignKey
ALTER TABLE "PageSubscription" ADD CONSTRAINT "PageSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageSubscription" ADD CONSTRAINT "PageSubscription_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
