import { findAccessibilityNodes, type AccessibilityMatch } from "../../core/query.js";
import type { AccessibilityNode } from "../../types.js";

export function revalidateBrowserSemanticTarget(
  candidate: AccessibilityMatch,
  currentTree: AccessibilityNode[],
  query: string,
  role?: string
): AccessibilityMatch {
  const current = findAccessibilityNodes(currentTree, query, role).find(
    (match) =>
      match.targetId === candidate.targetId &&
      match.automationId === candidate.automationId &&
      match.enabled !== false
  );

  if (!current) {
    throw new Error(
      `Browser accessibility target "${candidate.targetId}" is stale or changed. Refresh browser accessibility state and find the target again.`
    );
  }

  return current;
}
