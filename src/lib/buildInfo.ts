function compact(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim()));
}

export function formatBuildLabel(
  buildName: string,
  buildNumber: string,
  prNumber: string,
) {
  const label = prNumber
    ? compact([`PR #${prNumber}`, buildName]).join(' · ')
    : buildName || 'dev';

  const suffix = buildNumber ? `Build #${buildNumber}` : '';
  return compact([label, suffix]).join(' · ');
}
