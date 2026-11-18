import React, { useState } from 'react';
import { BookOpen, Download, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { LANGUAGES } from '../../shared/catalog';
import type { GlossaryEntry } from '../../shared/types';

interface Props {
  isOpen: boolean;
  entries: GlossaryEntry[];
  onClose: () => void;
  onSave: (entries: GlossaryEntry[]) => Promise<void>;
  onImport: () => Promise<void>;
  onExport: () => Promise<void>;
}

export const GlossaryModal: React.FC<Props> = ({
  isOpen,
  entries,
  onClose,
  onSave,
  onImport,
  onExport,
}) => {
  const [sourceTerm, setSourceTerm] = useState('');
  const [targetTerm, setTargetTerm] = useState('');
  const [sourceLang, setSourceLang] = useState('any');
  const [targetLang, setTargetLang] = useState('any');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const langOptions = [
    { code: 'any', label: '모든 언어' },
    ...LANGUAGES.filter((l) => l.code !== 'auto').map((l) => ({ code: l.code, label: l.label })),
  ];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceTerm.trim() || !targetTerm.trim()) return;
    const next: GlossaryEntry[] = [
      {
        id: crypto.randomUUID(),
        sourceTerm: sourceTerm.trim(),
        targetTerm: targetTerm.trim(),
        sourceLang,
        targetLang,
        enabled: true,
        note: note.trim() || undefined,
      },
      ...entries,
    ];
    await onSave(next);
    setSourceTerm('');
    setTargetTerm('');
    setNote('');
  };

  const handleToggle = async (id: string) => {
    const next = entries.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e));
    await onSave(next);
  };

  const handleDelete = async (id: string) => {
    await onSave(entries.filter((e) => e.id !== id));
  };

  const filtered = entries.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      item.sourceTerm.toLowerCase().includes(q) ||
      item.targetTerm.toLowerCase().includes(q) ||
      (item.note ?? '').toLowerCase().includes(q)
    );
  });

  const getLangLabel = (code: string) =>
    langOptions.find((l) => l.code === code)?.label ?? code;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <BookOpen className="h-5 w-5 text-emerald-400" />
              사용자 정의 용어집 (Glossary)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              원문에 등장하는 용어만 자동으로 감지하여 시스템 프롬프트에 주입하므로 토큰 낭비 없이 용어 일관성을 유지합니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Add Form */}
        <form onSubmit={handleAdd} className="border-b border-slate-800 bg-slate-950/60 px-6 py-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <input
              type="text"
              placeholder="원문 용어 (예: sidecar)"
              value={sourceTerm}
              onChange={(e) => setSourceTerm(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="번역 용어 (예: 사이드카)"
              value={targetTerm}
              onChange={(e) => setTargetTerm(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {langOptions.map((l) => (
                <option key={`src-${l.code}`} value={l.code}>
                  원문: {l.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">→</span>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {langOptions.map((l) => (
                <option key={`dst-${l.code}`} value={l.code}>
                  대상: {l.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="메모 (선택, 예: 기술 용어)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-w-[140px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!sourceTerm.trim() || !targetTerm.trim()}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              추가
            </button>
          </div>
        </form>

        {/* Search & Import/Export */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-6 py-2.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="용어 검색..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pr-3 pl-8 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void onImport()}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              <Upload className="h-3.5 w-3.5" />
              JSON 가져오기
            </button>
            <button
              onClick={() => void onExport()}
              disabled={entries.length === 0}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              내보내기
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {entries.length === 0
                ? '등록된 용어가 없습니다. 위 입력란에서 자주 쓰는 전문 용어를 추가해 보세요.'
                : '검색 결과가 없습니다.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 py-2.5 ${
                    item.enabled ? '' : 'opacity-45'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={() => void handleToggle(item.id)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-emerald-500"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-white">{item.sourceTerm}</span>
                        <span className="text-slate-500">→</span>
                        <span className="font-medium text-emerald-300">{item.targetTerm}</span>
                        {item.note && (
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                            {item.note}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {getLangLabel(item.sourceLang)} → {getLangLabel(item.targetLang)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => void handleDelete(item.id)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
