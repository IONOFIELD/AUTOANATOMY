/**
 * Pattern matching shared by models.json (mesh -> layer) and parts.json
 * (mesh -> part info). A pattern is an exact mesh name, or a prefix ending
 * in '*' (e.g. "Int_Piston_*"). Exact matches beat wildcards; among
 * wildcards the longest prefix wins.
 */
export function resolvePattern<T>(map: Record<string, T>, meshName: string): T | undefined {
  if (meshName in map) return map[meshName];
  let best: T | undefined;
  let bestLen = -1;
  for (const [pattern, value] of Object.entries(map)) {
    if (!pattern.endsWith('*')) continue;
    const prefix = pattern.slice(0, -1);
    if (meshName.startsWith(prefix) && prefix.length > bestLen) {
      best = value;
      bestLen = prefix.length;
    }
  }
  return best;
}

/** "sw221_lowerarm_F_a_145" -> "lowerarm F a" — fallback label for unmapped parts. */
export function prettifyMeshName(meshName: string): string {
  return meshName
    .replace(/^s?w\d{3}_/i, '') // asset-pack chassis-code prefixes (sw221_, w221_, ...)
    .replace(/[._]\d+$/, '') // exporter numeric suffixes
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}
