import type { WorkProduct } from '@/types/orchestration';

interface Props {
  workProducts: WorkProduct[];
}

export function WorkProductAssets({ workProducts }: Props) {
  const paths: string[] = [];
  for (const wp of workProducts) {
    if (wp.filePath?.trim()) paths.push(wp.filePath.trim());
    for (const asset of wp.assetPaths ?? []) {
      const trimmed = asset?.trim();
      if (trimmed && !paths.includes(trimmed)) paths.push(trimmed);
    }
  }
  if (paths.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-medium text-gray-500 mb-1">Artifact paths</h4>
      <ul className="space-y-1">
        {paths.map((p) => (
          <li key={p} className="text-xs font-mono text-cyan-400/90 break-all">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
