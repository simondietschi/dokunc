-- CreateTable
CREATE TABLE "SpaceInvitation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "SpaceRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaceInvitation_tokenHash_key" ON "SpaceInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "SpaceInvitation_spaceId_idx" ON "SpaceInvitation"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceInvitation_spaceId_email_key" ON "SpaceInvitation"("spaceId", "email");

-- AddForeignKey
ALTER TABLE "SpaceInvitation" ADD CONSTRAINT "SpaceInvitation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
