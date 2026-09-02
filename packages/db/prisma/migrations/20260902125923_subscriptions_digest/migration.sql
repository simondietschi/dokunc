-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAGE_CHANGED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digestSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PageSubscription" (
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "includeChildren" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSubscription_pkey" PRIMARY KEY ("userId","pageId")
);

-- CreateIndex
CREATE INDEX "PageSubscription_pageId_idx" ON "PageSubscription"("pageId");

-- AddForeignKey
ALTER TABLE "PageSubscription" ADD CONSTRAINT "PageSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageSubscription" ADD CONSTRAINT "PageSubscription_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
