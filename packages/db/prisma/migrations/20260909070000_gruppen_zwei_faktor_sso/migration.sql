-- CreateEnum
CREATE TYPE "SpaceVisibility" AS ENUM ('PRIVATE', 'OPEN');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'FILE');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "kind" "AttachmentKind" NOT NULL DEFAULT 'IMAGE';

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "accessRootId" TEXT,
ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "isRestricted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "joinRole" "SpaceRole" NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "visibility" "SpaceVisibility" NOT NULL DEFAULT 'PRIVATE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "oidcIssuer" TEXT,
ADD COLUMN     "oidcSubject" TEXT,
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "PageSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSubscription_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "spaceId" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotpRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

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
CREATE INDEX "PageSubscription_pageId_idx" ON "PageSubscription"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageSubscription_userId_pageId_key" ON "PageSubscription"("userId", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageShare_tokenHash_key" ON "PageShare"("tokenHash");

-- CreateIndex
CREATE INDEX "PageShare_pageId_idx" ON "PageShare"("pageId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_spaceId_createdAt_idx" ON "AuditLog"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "TotpRecoveryCode_userId_usedAt_idx" ON "TotpRecoveryCode"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TotpRecoveryCode_userId_codeHash_key" ON "TotpRecoveryCode"("userId", "codeHash");

-- CreateIndex
CREATE INDEX "Attachment_uploaderId_idx" ON "Attachment"("uploaderId");

-- CreateIndex
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Page_accessRootId_idx" ON "Page"("accessRootId");

-- CreateIndex
CREATE UNIQUE INDEX "User_oidcIssuer_oidcSubject_key" ON "User"("oidcIssuer", "oidcSubject");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "PageSubscription" ADD CONSTRAINT "PageSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageSubscription" ADD CONSTRAINT "PageSubscription_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageShare" ADD CONSTRAINT "PageShare_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

