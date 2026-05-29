import { useState } from 'react';
import { useTradingAdmin, type CreatorItemMeta } from '@/hooks/useOrchestration';

type RegenerateFeedback = {
  error: string;
  details: string[];
  remediation?: string;
} | null;

export function CreatorDashboard() {
  const {
    creatorItems,
    creatorPurposes,
    checkConflict,
    generateItems,
    getCreatorItem,
    updateCreatorItem,
    regenerateCreatorItem,
    setCreatorStatus,
    deleteCreatorItem,
  } = useTradingAdmin();

  const [creatorName, setCreatorName] = useState('');
  const [creatorPurpose, setCreatorPurpose] = useState('trading');
  const [creatorPrompt, setCreatorPrompt] = useState('');
  const [createSkill, setCreateSkill] = useState(true);
  const [createMcp, setCreateMcp] = useState(false);
  const [createTemplate, setCreateTemplate] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CreatorItemMeta | null>(null);
  const [detailNotes, setDetailNotes] = useState('');
  const [detailContent, setDetailContent] = useState('');
  const [detailPrompt, setDetailPrompt] = useState('');
  const [creatorMessage, setCreatorMessage] = useState('');
  const [regenerateFeedback, setRegenerateFeedback] = useState<RegenerateFeedback>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const getLoadStateText = (status: CreatorItemMeta['status']) => {
    if (status === 'approved') return 'loaded';
    return 'not loaded';
  };

  const openItem = async (item: CreatorItemMeta) => {
    const detail = await getCreatorItem(item.type, item.slug);
    setSelectedItem(item);
    setDetailNotes(detail?.meta.notes || '');
    const firstContent = detail ? Object.values(detail.content)[0] || '' : '';
    setDetailContent(firstContent);
    setDetailPrompt('');
    setRegenerateFeedback(null);
  };

  const createGeneratedItems = async () => {
    if (!creatorName.trim() || !creatorPurpose.trim()) return;
    setCreatorMessage('');
    const targets = [
      createSkill ? 'skill' : '',
      createMcp ? 'mcp' : '',
      createTemplate ? 'template' : '',
    ].filter(Boolean);
    if (targets.length === 0) {
      setCreatorMessage('Select at least one target: skill, mcp, template.');
      return;
    }
    const firstType = targets[0] as 'skill' | 'mcp' | 'template';
    const conflict = await checkConflict(firstType, creatorName.trim(), creatorPurpose.trim());
    if (conflict?.exact) {
      setCreatorMessage(`Duplicate found for ${firstType}. Use another name.`);
      return;
    }
    if (Array.isArray(conflict?.similar) && conflict.similar.length > 0) {
      const names = conflict.similar.map((entry: { name: string }) => entry.name).join(', ');
      const ok = window.confirm(`Similar items found: ${names}. Continue create?`);
      if (!ok) return;
    }
    setIsGenerating(true);
    setCreatorMessage('Generating with model...');
    try {
      const result = await generateItems({
        name: creatorName.trim(),
        purpose: creatorPurpose.trim(),
        prompt: creatorPrompt.trim(),
        generate: {
          skill: createSkill,
          mcp: createMcp,
          template: createTemplate,
        },
      });
      if (result?.error) {
        setCreatorMessage(String(result.error));
        return;
      }
      setCreatorMessage('Generated in workspace as draft.');
      setCreatorName('');
      setCreatorPrompt('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Generate failed. Check server logs.';
      setCreatorMessage(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const saveDraft = async () => {
    if (!selectedItem) return;
    await updateCreatorItem(selectedItem.type, selectedItem.slug, {
      notes: detailNotes,
      content: detailContent,
      purpose: selectedItem.purpose,
    });
    await openItem(selectedItem);
    setCreatorMessage('Draft saved.');
  };

  const doRegenerate = async () => {
    if (!selectedItem || !detailPrompt.trim()) return;
    setRegenerateFeedback(null);
    const response = await regenerateCreatorItem(selectedItem.type, selectedItem.slug, detailPrompt.trim());
    if (response?.error) {
      const detailList = Array.isArray(response?.details)
        ? response.details.map((entry: unknown) => String(entry))
        : [];
      setRegenerateFeedback({
        error: String(response.error),
        details: detailList,
        remediation: typeof response?.remediation === 'string' ? response.remediation : undefined,
      });
      return;
    }
    await openItem(selectedItem);
    setCreatorMessage('Regenerated and moved to draft.');
  };

  const doStatus = async (status: 'approved' | 'disabled' | 'draft') => {
    if (!selectedItem) return;
    const ok = window.confirm(`Change status to ${status}?`);
    if (!ok) return;
    await setCreatorStatus(selectedItem.type, selectedItem.slug, status);
    await openItem(selectedItem);
  };

  const doDelete = async () => {
    if (!selectedItem) return;
    const ok = window.confirm(`Delete ${selectedItem.type}:${selectedItem.name}?`);
    if (!ok) return;
    await deleteCreatorItem(selectedItem.type, selectedItem.slug);
    setSelectedItem(null);
    setDetailContent('');
    setDetailNotes('');
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <h4 className="font-semibold mb-3">Workspace Creator</h4>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
            value={creatorName}
            onChange={(e) => setCreatorName(e.target.value)}
            placeholder="Item name"
          />
          <input
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
            value={creatorPurpose}
            onChange={(e) => setCreatorPurpose(e.target.value)}
            placeholder="Purpose"
            list="creator-purpose-options"
          />
          <datalist id="creator-purpose-options">
            {creatorPurposes.map((purpose) => (
              <option key={purpose} value={purpose} />
            ))}
          </datalist>
        </div>
        <textarea
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm mb-3"
          value={creatorPrompt}
          onChange={(e) => setCreatorPrompt(e.target.value)}
          placeholder="Describe what should be generated"
          rows={3}
        />
        <div className="flex items-center gap-4 text-sm mb-3">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={createSkill} onChange={(e) => setCreateSkill(e.target.checked)} />
            Skill
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={createMcp} onChange={(e) => setCreateMcp(e.target.checked)} />
            MCP
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={createTemplate} onChange={(e) => setCreateTemplate(e.target.checked)} />
            Template
          </label>
          <button
            onClick={createGeneratedItems}
            disabled={isGenerating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-medium"
          >
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>
        </div>
        {creatorMessage ? <p className="text-xs text-yellow-300">{creatorMessage}</p> : null}
      </div>

      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <h4 className="font-semibold mb-3">Workspace Items ({creatorItems.length})</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2 max-h-72 overflow-auto">
            {creatorItems.map((item) => (
              <button
                key={`${item.type}-${item.slug}`}
                onClick={() => openItem(item)}
                className="w-full text-left p-2 rounded border border-gray-700 bg-gray-900/50 hover:border-green-500"
              >
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-gray-400">{item.type} • {item.purpose} • {item.status} • {getLoadStateText(item.status)}</p>
              </button>
            ))}
            {creatorItems.length === 0 && <p className="text-sm text-gray-400">No generated items yet.</p>}
          </div>
          <div className="space-y-2">
            {!selectedItem && <p className="text-sm text-gray-400">Select item to view details.</p>}
            {selectedItem && (
              <>
                <p className="text-sm font-semibold">{selectedItem.name}</p>
                <p className="text-xs text-gray-400">{selectedItem.type} • {selectedItem.purpose} • v{selectedItem.version} • {getLoadStateText(selectedItem.status)}</p>
                <textarea
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
                  rows={2}
                  value={detailNotes}
                  onChange={(e) => setDetailNotes(e.target.value)}
                  placeholder="Notes"
                />
                <textarea
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
                  rows={8}
                  value={detailContent}
                  onChange={(e) => setDetailContent(e.target.value)}
                  placeholder="Content"
                />
                <div className="flex gap-2 flex-wrap">
                  <button onClick={saveDraft} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs">Save Draft</button>
                  <button onClick={() => doStatus('approved')} className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs">Approve</button>
                  <button onClick={() => doStatus('disabled')} className="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 rounded text-xs">Disable</button>
                  <button onClick={doDelete} className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs">Delete</button>
                </div>
                <textarea
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
                  rows={2}
                  value={detailPrompt}
                  onChange={(e) => {
                    setDetailPrompt(e.target.value);
                    if (regenerateFeedback) {
                      setRegenerateFeedback(null);
                    }
                  }}
                  placeholder="Regenerate prompt"
                />
                <button onClick={doRegenerate} className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs">Regenerate</button>
                {regenerateFeedback && (
                  <div className="mt-2 rounded border border-red-700 bg-red-950/40 p-3">
                    <p className="text-xs font-semibold text-red-300">Regenerate blocked by safety policy</p>
                    <p className="mt-1 text-xs text-red-200">{regenerateFeedback.error}</p>
                    {regenerateFeedback.details.length > 0 && (
                      <ul className="mt-2 list-disc pl-4 text-xs text-red-100">
                        {regenerateFeedback.details.map((detail, index) => (
                          <li key={`${detail}-${index}`}>{detail}</li>
                        ))}
                      </ul>
                    )}
                    {regenerateFeedback.remediation && (
                      <p className="mt-2 text-xs text-yellow-200">Tip: {regenerateFeedback.remediation}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
