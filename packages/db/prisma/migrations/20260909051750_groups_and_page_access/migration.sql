-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "accessRootId" TEXT,
ADD COLUMN     "isRestricted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceGroup" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "SpaceRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "SpaceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageGrant" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,

    CONSTRAINT "PageGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "SpaceGroup_groupId_idx" ON "SpaceGroup"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceGroup_spaceId_groupId_key" ON "SpaceGroup"("spaceId", "groupId");

-- CreateIndex
CREATE INDEX "PageGrant_pageId_idx" ON "PageGrant"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageGrant_pageId_userId_key" ON "PageGrant"("pageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PageGrant_pageId_groupId_key" ON "PageGrant"("pageId", "groupId");

-- CreateIndex
CREATE INDEX "Page_accessRootId_idx" ON "Page"("accessRootId");

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceGroup" ADD CONSTRAINT "SpaceGroup_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceGroup" ADD CONSTRAINT "SpaceGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageGrant" ADD CONSTRAINT "PageGrant_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageGrant" ADD CONSTRAINT "PageGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageGrant" ADD CONSTRAINT "PageGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_accessRootId_fkey" FOREIGN KEY ("accessRootId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
