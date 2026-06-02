-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "ownerTeamId" TEXT,
    "name" TEXT NOT NULL,
    "framework" TEXT,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Knowledge" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'user',
    "ownerUserId" TEXT,
    "ownerTeamId" TEXT,
    "ownerProjectId" TEXT,
    "triggerText" TEXT NOT NULL,
    "ruleText" TEXT NOT NULL,
    "rationale" TEXT,
    "symbolicWhen" TEXT,
    "symbolicThen" TEXT,
    "instead" TEXT,
    "embedding" vector(1536),
    "framework" TEXT,
    "language" TEXT,
    "tags" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "decayScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "extractedBy" TEXT NOT NULL DEFAULT 'kea',
    "sourceSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "parentKnowledgeId" TEXT,

    CONSTRAINT "Knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "frontmatter" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "ownerTeamId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'user',
    "stage" TEXT NOT NULL DEFAULT 'notes',
    "kind" TEXT NOT NULL DEFAULT 'output',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dependencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedding" vector(1536),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "mastery" INTEGER NOT NULL DEFAULT 1,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentSkillId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "teamId" TEXT,
    "parentSessionId" TEXT,
    "clientType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "sqs" DOUBLE PRECISION,
    "metadata" JSONB,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionKnowledgeApplication" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "knowledgeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionKnowledgeApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'user',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdBy" TEXT NOT NULL,
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeerCard" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "ownerProjectId" TEXT,
    "facts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeerCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoskillProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetId" TEXT,
    "confidence" TEXT NOT NULL,
    "diff" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AutoskillProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "knowledgeId" TEXT,
    "skillId" TEXT,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "feedbackType" TEXT NOT NULL DEFAULT 'session',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MCPToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MCPToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunitySkill" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "publishedByUserId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION,
    "averageRating" DOUBLE PRECISION,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "moderationStatus" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "CommunitySkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "communitySkillId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "SkillImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OracleCostLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OracleCostLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeHealthSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantScope" TEXT NOT NULL,
    "usedInLast30Days" INTEGER NOT NULL,
    "totalActive" INTEGER NOT NULL,
    "averageConfidence" DOUBLE PRECISION NOT NULL,
    "contradictionCount" INTEGER NOT NULL,
    "medianAgeDays" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "KnowledgeHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_userId_teamId_key" ON "TeamMembership"("userId", "teamId");

-- CreateIndex
CREATE INDEX "Knowledge_ownerUserId_type_scope_idx" ON "Knowledge"("ownerUserId", "type", "scope");

-- CreateIndex
CREATE INDEX "Knowledge_ownerUserId_confidence_idx" ON "Knowledge"("ownerUserId", "confidence");

-- CreateIndex
CREATE INDEX "Knowledge_parentKnowledgeId_idx" ON "Knowledge"("parentKnowledgeId");

-- CreateIndex
CREATE INDEX "Skill_scope_stage_idx" ON "Skill"("scope", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_skillId_ownerUserId_key" ON "Skill"("skillId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_skillId_ownerTeamId_key" ON "Skill"("skillId", "ownerTeamId");

-- CreateIndex
CREATE INDEX "Session_userId_startedAt_idx" ON "Session"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Session_parentSessionId_idx" ON "Session"("parentSessionId");

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_timestamp_idx" ON "SessionEvent"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "SessionEvent_eventType_idx" ON "SessionEvent"("eventType");

-- CreateIndex
CREATE INDEX "SessionKnowledgeApplication_knowledgeId_idx" ON "SessionKnowledgeApplication"("knowledgeId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionKnowledgeApplication_sessionId_knowledgeId_role_key" ON "SessionKnowledgeApplication"("sessionId", "knowledgeId", "role");

-- CreateIndex
CREATE INDEX "GraphEdge_sourceId_idx" ON "GraphEdge"("sourceId");

-- CreateIndex
CREATE INDEX "GraphEdge_targetId_idx" ON "GraphEdge"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEdge_sourceId_targetId_relation_key" ON "GraphEdge"("sourceId", "targetId", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "PeerCard_ownerUserId_ownerProjectId_key" ON "PeerCard"("ownerUserId", "ownerProjectId");

-- CreateIndex
CREATE INDEX "AutoskillProposal_userId_status_idx" ON "AutoskillProposal"("userId", "status");

-- CreateIndex
CREATE INDEX "AutoskillProposal_sessionId_idx" ON "AutoskillProposal"("sessionId");

-- CreateIndex
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MCPToken_tokenHash_key" ON "MCPToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MCPToken_userId_idx" ON "MCPToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunitySkill_skillId_key" ON "CommunitySkill"("skillId");

-- CreateIndex
CREATE INDEX "CommunitySkill_moderationStatus_idx" ON "CommunitySkill"("moderationStatus");

-- CreateIndex
CREATE INDEX "SkillImport_userId_idx" ON "SkillImport"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillImport_userId_communitySkillId_key" ON "SkillImport"("userId", "communitySkillId");

-- CreateIndex
CREATE INDEX "OracleCostLedger_day_idx" ON "OracleCostLedger"("day");

-- CreateIndex
CREATE UNIQUE INDEX "OracleCostLedger_userId_day_key" ON "OracleCostLedger"("userId", "day");

-- CreateIndex
CREATE INDEX "KnowledgeHealthSnapshot_tenantScope_snapshotAt_idx" ON "KnowledgeHealthSnapshot"("tenantScope", "snapshotAt");

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_ownerProjectId_fkey" FOREIGN KEY ("ownerProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionKnowledgeApplication" ADD CONSTRAINT "SessionKnowledgeApplication_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "edge_source_knowledge_fk" FOREIGN KEY ("sourceId") REFERENCES "Knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "edge_target_knowledge_fk" FOREIGN KEY ("targetId") REFERENCES "Knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerCard" ADD CONSTRAINT "PeerCard_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerCard" ADD CONSTRAINT "PeerCard_ownerProjectId_fkey" FOREIGN KEY ("ownerProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoskillProposal" ADD CONSTRAINT "AutoskillProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCPToken" ADD CONSTRAINT "MCPToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCPToken" ADD CONSTRAINT "MCPToken_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySkill" ADD CONSTRAINT "CommunitySkill_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

