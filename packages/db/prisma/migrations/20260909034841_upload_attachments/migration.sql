-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('IMAGE', 'FILE');

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "kind" "UploadKind" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "originalName" TEXT NOT NULL DEFAULT '';
