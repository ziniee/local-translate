import React, { useEffect, useState } from 'react';
import { FolderOpen, Settings as SettingsIcon, Terminal, X } from 'lucide-react';
import type { AppSettings, BackendPreference, HardwareInfo } from '../../shared/types';

interface Props {
  isOpen: boolean;
  settings: AppSettings;
  hardware: HardwareInfo | null;
  onClose: () => void;
  onSave: (patch: Partial<AppSettings>) => Promise<{ shortcutRegistered: boolean }>;
  onChooseModelsDir: () => Promise<void>;
}

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  settings,
  hardware,
  onClose,
  onSave,
  onChooseModelsDir,
}) => {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [shortcutWarn, setShortcutWarn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
    setShortcutWarn(null);
  }, [settings, isOpen]);

  useEffect(() => {
    if (isOpen && showLogs) {
      void window.localTranslate.getEngineLogs().then(setLogs);
    }
  }, [isOpen, showLogs]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setShortcutWarn(null);
    try {
      const { shortcutRegistered } = await onSave({
        preferredBackend: draft.preferredBackend,
        gpuLayers: draft.gpuLayers,
        contextSize: draft.contextSize,
        threads: draft.threads,
        temperature: draft.temperature,
        flashAttention: draft.flashAttention,
        cachePrompt: draft.cachePrompt,
        chunkSize: draft.chunkSize,
        preserveCodeBlocks: draft.preserveCodeBlocks,
        globalShortcut: draft.globalShortcut,
        minimizeToTray: draft.minimizeToTray,
      });
      if (!shortcutRegistered) {
        setShortcutWarn('지정한 단축키가 다른 프로그램과 충돌하여 등록되지 않았습니다.');
      } else {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <SettingsIcon className="h-5 w-5 text-blue-400" />
            추론 엔진 및 앱 설정
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-sm">
          {/* Hardware Acceleration */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              하드웨어 가속 (CUDA → Vulkan → CPU 자동 폴백)
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-slate-300">추론 백엔드</span>
                <select
                  value={draft.preferredBackend}
                  onChange={(e) =>
                    setDraft({ ...draft, preferredBackend: e.target.value as BackendPreference })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="auto">
                    자동 감지 (권장: {hardware?.recommendedBackend.toUpperCase() ?? 'AUTO'})
                  </option>
                  <option value="cuda">NVIDIA CUDA (실패 시 Vulkan → CPU)</option>
                  <option value="vulkan">Vulkan GPU (실패 시 CPU)</option>
                  <option value="cpu">CPU 전용 (AVX2)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs text-slate-300">
                  GPU 오프로드 레이어 (-ngl, 99 = 전체 GPU 적재)
                </span>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={draft.gpuLayers}
                  onChange={(e) => setDraft({ ...draft, gpuLayers: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs text-slate-300">컨텍스트 크기 (-c)</span>
                <select
                  value={draft.contextSize}
                  onChange={(e) => setDraft({ ...draft, contextSize: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value={4096}>4,096 토큰 (저VRAM 절약)</option>
                  <option value={8192}>8,192 토큰 (RTX 3060 12GB 권장)</option>
                  <option value={16384}>16,384 토큰 (초장문)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs text-slate-300">CPU 스레드 수 (0 = 자동)</span>
                <input
                  type="number"
                  min={0}
                  max={64}
                  value={draft.threads}
                  onChange={(e) => setDraft({ ...draft, threads: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-5 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.flashAttention}
                  onChange={(e) => setDraft({ ...draft, flashAttention: e.target.checked })}
                  className="h-4 w-4 accent-blue-500"
                />
                Flash Attention 활성화 (VRAM 절감 · 속도 향상)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.cachePrompt}
                  onChange={(e) => setDraft({ ...draft, cachePrompt: e.target.checked })}
                  className="h-4 w-4 accent-blue-500"
                />
                시스템 프롬프트 KV 캐시 재사용
              </label>
            </div>
          </section>

          {/* Translation Pipeline */}
          <section className="space-y-3 border-t border-slate-800 pt-4">
            <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              번역 품질 및 긴 글 분할
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-slate-300">
                  Temperature ({draft.temperature.toFixed(2)}) — 낮을수록 일관성 높음
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.8}
                  step={0.05}
                  value={draft.temperature}
                  onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                  className="w-full accent-blue-500"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs text-slate-300">청크 최대 글자 수 (자동 분할 기준)</span>
                <input
                  type="number"
                  min={300}
                  max={4000}
                  step={100}
                  value={draft.chunkSize}
                  onChange={(e) => setDraft({ ...draft, chunkSize: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>
          </section>

          {/* Windows Integration */}
          <section className="space-y-3 border-t border-slate-800 pt-4">
            <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Windows 통합 및 저장 경로
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-slate-300">클립보드 즉시 번역 글로벌 단축키</span>
                <input
                  type="text"
                  value={draft.globalShortcut}
                  onChange={(e) => setDraft({ ...draft, globalShortcut: e.target.value })}
                  placeholder="Alt+Shift+T"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </label>

              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.minimizeToTray}
                    onChange={(e) => setDraft({ ...draft, minimizeToTray: e.target.checked })}
                    className="h-4 w-4 accent-blue-500"
                  />
                  창 닫기 시 시스템 트레이로 최소화
                </label>
              </div>
            </div>
            {shortcutWarn && <p className="text-xs text-amber-400">{shortcutWarn}</p>}

            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400">모델 저장 폴더</div>
                <div className="truncate font-mono text-xs text-slate-200">{settings.modelsDir}</div>
              </div>
              <button
                onClick={() => void onChooseModelsDir()}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                변경
              </button>
            </div>
          </section>

          {/* Engine Logs Diagnostics */}
          <section className="border-t border-slate-800 pt-3">
            <button
              onClick={() => setShowLogs((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              <Terminal className="h-3.5 w-3.5" />
              {showLogs ? '엔진 진단 로그 숨기기' : '최근 llama-server 엔진 진단 로그 보기'}
            </button>
            {showLogs && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-black/70 p-3 font-mono text-[11px] text-slate-300">
                {logs.length > 0 ? logs.join('\n') : '(기록된 엔진 로그가 없습니다)'}
              </pre>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/60 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            취소
          </button>
          <button
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? '적용 중...' : '저장 및 엔진 적용'}
          </button>
        </div>
      </div>
    </div>
  );
};
