CREATE INDEX "ApprovalRequest_boardId_agentSessionId_status_idx"
  ON "ApprovalRequest"("boardId", "agentSessionId", "status");
