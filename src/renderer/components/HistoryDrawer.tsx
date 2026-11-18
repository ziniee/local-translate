import React, { useState } from 'react';
import { Clock, Search, Trash2, X } from 'lucide-react';
import { getLanguageByCode } from '../../shared/catalog';
import type { HistoryEntry } from '../../shared/types';
import { formatRelativeTime } from '../utils/format';

interface Props {
  isOpen: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
}

export const HistoryDrawer: React.FC<Props> = ({
  isOpen,
  entries,
  onClose,
  onSelect,
  onDelete,
  onClearAll,
}) => {
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const filtered = entries.filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      item.sourceText.toLowerCase().includes(q) ||
      item.translatedText.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Clock className="h-4 w-4 text-blue-400" />
            번역 기록 ({entries.length})
          </h2>
          <div className="flex items-center gap-2">
            {entries.length > 0 && (
              <button
                onClick={() => void onClearAll()}
                className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-red-500/10 hover:text-red-400"
              >
                전체 삭제
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="border-b border-slate-800 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="기록 검색..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pr-3 pl-8 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              저장된 번역 기록이 없습니다.
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  onSelect(item);
                  onClose();
                }}
                className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-950/60 p-3 transition hover:border-blue-500/50 hover:bg-slate-800/60"
              >
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {getLanguageByCode(item.sourceLang)?.label ?? item.sourceLang} →{' '}
                    {getLanguageByCode(item.targetLang)?.label ?? item.targetLang}
                  </span>
                  <div className="flex items-center gap-2">
                    <span>{formatRelativeTime(item.createdAt)}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDelete(item.id);
                      }}
                      className="opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="line-clamp-2 text-xs text-slate-300">{item.sourceText}</p>
                <p className="mt-1 line-clamp-2 text-xs text-blue-300">{item.translatedText}</p>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                  <span>{item.modelName}</span>
                  {item.tokensPerSec > 0 && <span>{item.tokensPerSec} tok/s</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
