
-- DropIndex
DROP INDEX "User_oidcSubject_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_oidcIssuer_oidcSubject_key" ON "User"("oidcIssuer", "oidcSubject");

