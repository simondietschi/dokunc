-- CreateEnum
CREATE TYPE "EmailNotificationMode" AS ENUM ('INSTANT', 'DAILY', 'OFF');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastEditedById" TEXT;

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "icon" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifications" "EmailNotificationMode" NOT NULL DEFAULT 'INSTANT';

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "pageId" TEXT,
    "uploaderId" TEXT,
    "storedName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storedName_key" ON "Attachment"("storedName");

-- CreateIndex
CREATE INDEX "Attachment_spaceId_idx" ON "Attachment"("spaceId");

-- CreateIndex
CREATE INDEX "Attachment_pageId_idx" ON "Attachment"("pageId");

-- CreateIndex
CREATE INDEX "Favorite_pageId_idx" ON "Favorite"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_pageId_key" ON "Favorite"("userId", "pageId");

-- CreateIndex
CREATE INDEX "PageVisit_userId_visitedAt_idx" ON "PageVisit"("userId", "visitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PageVisit_userId_pageId_key" ON "PageVisit"("userId", "pageId");

-- CreateIndex
CREATE INDEX "Notification_emailedAt_createdAt_idx" ON "Notification"("emailedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Page_spaceId_isTemplate_idx" ON "Page"("spaceId", "isTemplate");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVisit" ADD CONSTRAINT "PageVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVisit" ADD CONSTRAINT "PageVisit_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
