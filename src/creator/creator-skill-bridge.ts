let reloadCreatorSkills: (() => Promise<number>) | null = null;

export function registerCreatorSkillReload(handler: () => Promise<number>): void {
  reloadCreatorSkills = handler;
}

export async function refreshCreatorWorkspaceSkills(): Promise<void> {
  if (!reloadCreatorSkills) return;
  try {
    const count = await reloadCreatorSkills();
    console.log(`[Creator] Refreshed ${count} workspace skill(s) in agent registry.`);
  } catch (err: any) {
    console.error('[Creator] Failed to refresh workspace skills:', err.message);
  }
}
