import { useState } from 'react';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { cn } from '@/lib/utils';

interface MarkdownFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  accent?: 'green' | 'blue';
  helperText?: string;
}

export function MarkdownField({
  label,
  value,
  onChange,
  placeholder,
  minRows = 5,
  accent = 'green',
  helperText = 'Markdown supported: **bold**, lists, links, headings, etc.',
}: MarkdownFieldProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const ring = accent === 'blue' ? 'focus:ring-blue-500' : 'focus:ring-green-500';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-gray-400">{label}</label>
        <div className="flex rounded-md border border-gray-700 overflow-hidden text-[10px]">
          <button
            type="button"
            onClick={() => setMode('write')}
            className={cn(
              'px-2 py-0.5 transition-colors',
              mode === 'write' ? 'bg-gray-700 text-gray-100' : 'bg-gray-900 text-gray-500 hover:text-gray-300',
            )}
          >
            Write
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={cn(
              'px-2 py-0.5 transition-colors',
              mode === 'preview' ? 'bg-gray-700 text-gray-100' : 'bg-gray-900 text-gray-500 hover:text-gray-300',
            )}
          >
            Preview
          </button>
        </div>
      </div>
      {helperText && <p className="text-[11px] text-gray-500">{helperText}</p>}
      {mode === 'write' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={minRows}
          className={cn(
            'w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm font-mono focus:outline-none focus:ring-1 resize-y',
            ring,
          )}
          placeholder={placeholder}
        />
      ) : (
        <div className="min-h-28 px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm text-gray-200">
          {value.trim() ? (
            <ChatMarkdown content={value} className="text-sm" />
          ) : (
            <p className="text-gray-500 italic text-xs">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
