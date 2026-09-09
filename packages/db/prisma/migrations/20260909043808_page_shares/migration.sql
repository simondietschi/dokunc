-- CreateTable
CREATE TABLE "PageShare" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "includeChildren" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageShare_tokenHash_key" ON "PageShare"("tokenHash");

-- CreateIndex
CREATE INDEX "PageShare_pageId_idx" ON "PageShare"("pageId");

-- AddForeignKey
ALTER TABLE "PageShare" ADD CONSTRAINT "PageShare_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
