-- CreateEnum
CREATE TYPE "SpaceVisibility" AS ENUM ('PRIVATE', 'OPEN');

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "joinRole" "SpaceRole" NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "visibility" "SpaceVisibility" NOT NULL DEFAULT 'PRIVATE';
