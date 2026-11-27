/** Called inside the creating transaction after locking the owner's session. heroArtwork/heroPhoto 仅差内嵌资产时不视为不同作品。 */
export function matchingResumeProject(db, owner, resumeId, config) {
  return db.prepare(`SELECT p.* FROM projects p
    WHERE p.owner_session_id=? AND p.resume_id=? AND p.deleted_at IS NULL
      AND (p.config_json::jsonb - 'heroArtwork' - 'heroPhoto')=(?::jsonb - 'heroArtwork' - 'heroPhoto')
    ORDER BY EXISTS (SELECT 1 FROM entitlements e WHERE e.project_id=p.id AND e.status='ACTIVE') DESC,
      EXISTS (SELECT 1 FROM orders o WHERE o.project_id=p.id) DESC, p.created_at DESC, p.id
    LIMIT 1 FOR UPDATE OF p`).get(owner, resumeId, config);
}
