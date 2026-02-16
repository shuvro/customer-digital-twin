-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('EXTRACT', 'SEARCH', 'DECIDE', 'PERSIST', 'RE_EXTRACT');

-- CreateEnum
CREATE TYPE "DecisionCode" AS ENUM ('TAXID_MATCH', 'HIGH_CONFIDENCE', 'MEDIUM_CONFIDENCE', 'BELOW_THRESHOLD', 'NO_CANDIDATES', 'NO_IDENTIFYING_INFO');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "decisionCode" "DecisionCode",
ADD COLUMN     "decisionReasoning" TEXT;

-- CreateTable
CREATE TABLE "PipelineLog" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER,
    "input" JSONB,
    "output" JSONB,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PipelineLog_messageId_sequence_key" ON "PipelineLog"("messageId", "sequence");

-- AddForeignKey
ALTER TABLE "PipelineLog" ADD CONSTRAINT "PipelineLog_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
