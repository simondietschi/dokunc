-- CreateTable
CREATE TABLE "PageFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVisit" (
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageVisit_pkey" PRIMARY KEY ("userId","pageId")
);

-- CreateIndex
CREATE INDEX "PageFavorite_userId_createdAt_idx" ON "PageFavorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PageFavorite_userId_pageId_key" ON "PageFavorite"("userId", "pageId");

-- CreateIndex
CREATE INDEX "PageVisit_userId_visitedAt_idx" ON "PageVisit"("userId", "visitedAt");

-- AddForeignKey
ALTER TABLE "PageFavorite" ADD CONSTRAINT "PageFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageFavorite" ADD CONSTRAINT "PageFavorite_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVisit" ADD CONSTRAINT "PageVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVisit" ADD CONSTRAINT "PageVisit_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
