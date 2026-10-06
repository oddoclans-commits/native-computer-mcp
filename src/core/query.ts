import type { AccessibilityNode } from "../types.js";

export interface AccessibilityMatch {
  targetId: string;
  role: string;
  name?: string;
  value?: string;
  automationId?: string;
  className?: string;
  bounds?: AccessibilityNode["bounds"];
  enabled?: boolean;
  focused?: boolean;
  score: number;
}

export function findAccessibilityNodes(
  roots: AccessibilityNode[],
  query: string,
  role?: string
): AccessibilityMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const normalizedRole = role?.trim().toLocaleLowerCase();
  const matches: AccessibilityMatch[] = [];

  const visit = (node: AccessibilityNode) => {
    const roleMatch =
      !normalizedRole || node.role.toLocaleLowerCase() === normalizedRole;

    if (roleMatch) {
      const fields = [
        [node.name, 8],
        [node.automationId, 6],
        [node.value, 4],
        [node.className, 2]
      ] as const;

      let score = 0;
      for (const [field, weight] of fields) {
        const value = field?.trim().toLocaleLowerCase();
        if (!value) continue;
        if (value === normalizedQuery) score = Math.max(score, weight + 10);
        else if (value.includes(normalizedQuery)) score = Math.max(score, weight);
      }

      if (score > 0) {
        matches.push({
          targetId: node.id,
          role: node.role,
          ...(node.name ? { name: node.name } : {}),
          ...(node.value ? { value: node.value } : {}),
          ...(node.automationId ? { automationId: node.automationId } : {}),
          ...(node.className ? { className: node.className } : {}),
          ...(node.bounds ? { bounds: node.bounds } : {}),
          ...(node.enabled !== undefined ? { enabled: node.enabled } : {}),
          ...(node.focused !== undefined ? { focused: node.focused } : {}),
          score
        });
      }
    }

    for (const child of node.children ?? []) visit(child);
  };

  for (const root of roots) visit(root);

  return matches.sort((a, b) => b.score - a.score).slice(0, 20);
}
