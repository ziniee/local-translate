import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BookOpen,
  Check,
  Clock,
  Code2,
  Copy,
  FileDown,
  FileUp,
  HardDrive,
  Languages,
  Loader2,
  Play,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { LANGUAGES, TONE_OPTIONS } from '../shared/catalog';
import type {
  ActiveBackend,
  AppRuntimeInfo,
  AppSettings,
  EngineDownloadProgress,
  EngineStatus,
  GlossaryEntry,
  HardwareInfo,
  HistoryEntry,
  InstalledModel,
  ModelCatalogItem,
  ModelDownloadProgress,
  TonePreset,
  TranslationStats,
} from '../shared/types';
import { GlossaryModal } from './components/GlossaryModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { ModelManagerModal } from './components/ModelManagerModal';
import { SettingsModal } from './components/SettingsModal';

const DEFAULT_ENGINE_STATUS: EngineStatus = {
  state: 'stopped',
  activeBackend: null,
  activeModelId: null,
  activeModelName: null,
  port: null,
  gpuLayers: 0,
  contextSize: 8192,
};

export default function App() {
  const [runtimeInfo, setRuntimeInfo] = useState<AppRuntimeInfo | null>(null);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogItem[]>([]);
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>(DEFAULT_ENGINE_STATUS);
  const [downloads, setDownloads] = useState<Record<string, ModelDownloadProgress>>({});
  const [engineDownloads, setEngineDownloads] = useState<
    Partial<Record<ActiveBackend, EngineDownloadProgress>>
  >({});
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Translation state
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('ko');
  const [tone, setTone] = useState<TonePreset>('natural');
  const [useGlossary, setUseGlossary] = useState(true);
  const [preserveCodeBlocks, setPreserveCodeBlocks] = useState(true);
  const [customInstruction, setCustomInstruction] = useState('');
  const [showCustomInstruction, setShowCustomInstruction] = useState(false);

  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [liveTps, setLiveTps] = useState(0);
  const [lastStats, setLastStats] = useState<TranslationStats | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Modals
  const [showModelsModal, setShowModelsModal] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [showGlossaryModal, setShowGlossaryModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const activeRequestIdRef = useRef<string | null>(null);
  const outputRef = useRef<HTMLTextAreaElement | null>(null);

  const refreshModels = useCallback(async () => {
    const list = await window.localTranslate.getInstalledModels();
    setInstalledModels(list);
    return list;
  }, []);

  const refreshHistory = useCallback(async () => {
    const list = await window.localTranslate.listHistory();
    setHistory(list);
  }, []);

  // Initial hydration
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [rt, hw, st, cat, inst, eng, gloss, hist] = await Promise.all([
        window.localTranslate.getRuntimeInfo(),
        window.localTranslate.detectHardware(),
        window.localTranslate.getSettings(),
        window.localTranslate.getModelCatalog(),
        window.localTranslate.getInstalledModels(),
        window.localTranslate.getEngineStatus(),
        window.localTranslate.listGlossary(),
        window.localTranslate.listHistory(),
      ]);
      if (!mounted) return;
      setRuntimeInfo(rt);
      setHardware(hw);
      setSettings(st);
      setCatalog(cat);
      setInstalledModels(inst);
      setEngineStatus(eng);
      setGlossary(gloss);
      setHistory(hist);
      setSourceLang(st.defaultSourceLang);
      setTargetLang(st.defaultTargetLang);
      setTone(st.defaultTone);
      setPreserveCodeBlocks(st.preserveCodeBlocks);

      if (inst.length === 0 || hw.availableEngines.length === 0) {
        setIsFirstRun(true);
        setShowModelsModal(true);
      }
    })();

    const offEngine = window.localTranslate.onEngineStatusChanged((status) => {
      setEngineStatus(status);
      if (status.state === 'error' && status.error) {
        setErrorBanner(status.error);
      } else if (status.state === 'ready') {
        setErrorBanner(null);
      }
    });

    const offEngineDownload = window.localTranslate.onEngineDownloadProgress((prog) => {
      setEngineDownloads((prev) => ({ ...prev, [prog.backend]: prog }));
    });

    const offDownload = window.localTranslate.onDownloadProgress((prog) => {
      setDownloads((prev) => ({ ...prev, [prog.modelId]: prog }));
      if (prog.state === 'completed') {
        void (async () => {
          const updated = await refreshModels();
          setIsFirstRun(false);
          const currentStatus = await window.localTranslate.getEngineStatus();
          if (currentStatus.state !== 'ready' && updated.some((m) => m.id === prog.modelId)) {
            await window.localTranslate.startEngine(prog.modelId);
          }
        })();
      }
    });

    const offStream = window.localTranslate.onTranslationStream((event) => {
      if (event.requestId !== activeRequestIdRef.current) return;

      switch (event.type) {
        case 'start':
          setChunkProgress({ current: 1, total: event.totalChunks });
          break;
        case 'chunk_start':
          setChunkProgress({ current: event.chunkIndex + 1, total: event.totalChunks });
          break;
        case 'token':
          setTranslatedText((prev) => prev + event.token);
          if (event.tokensPerSec > 0) setLiveTps(event.tokensPerSec);
          break;
        case 'done':
          setTranslatedText(event.fullText);
          setLastStats(event.stats);
          setLiveTps(event.stats.tokensPerSec);
          setIsTranslating(false);
          setChunkProgress(null);
          activeRequestIdRef.current = null;
          void refreshHistory();
          break;
        case 'aborted':
          setIsTranslating(false);
          setChunkProgress(null);
          activeRequestIdRef.current = null;
          break;
        case 'error':
          setErrorBanner(event.error);
          setIsTranslating(false);
          setChunkProgress(null);
          activeRequestIdRef.current = null;
          break;
      }
    });

    return () => {
      mounted = false;
      offEngine();
      offEngineDownload();
      offDownload();
      offStream();
    };
  }, [refreshModels, refreshHistory]);

  // Auto-scroll translation output while streaming
  useEffect(() => {
    if (isTranslating && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [translatedText, isTranslating]);

  const runTranslation = useCallback(
    async (textOverride?: string) => {
      const textToTranslate = textOverride !== undefined ? textOverride : sourceText;
      if (!textToTranslate.trim()) return;

      if (engineStatus.state !== 'ready') {
        setErrorBanner(
          installedModels.length === 0
            ? '먼저 로컬 LLM 모델을 다운로드하거나 가져와 주세요.'
            : '로컬 엔진이 아직 준비되지 않았습니다. 상단에서 모델을 로드해 주세요.',
        );
        if (installedModels.length === 0) setShowModelsModal(true);
        return;
      }

      if (activeRequestIdRef.current) {
        await window.localTranslate.abortTranslation(activeRequestIdRef.current);
      }

      const requestId = crypto.randomUUID();
      activeRequestIdRef.current = requestId;
      setErrorBanner(null);
      setTranslatedText('');
      setLastStats(null);
      setLiveTps(0);
      setIsTranslating(true);

      await window.localTranslate.translate({
        requestId,
        text: textToTranslate,
        sourceLang,
        targetLang,
        tone,
        customInstruction: customInstruction.trim() || undefined,
        useGlossary,
        preserveCodeBlocks,
        chunkSize: settings?.chunkSize,
      });
    },
    [
      sourceText,
      engineStatus.state,
      installedModels.length,
      sourceLang,
      targetLang,
      tone,
      customInstruction,
      useGlossary,
      preserveCodeBlocks,
      settings?.chunkSize,
    ],
  );

  // Listen to global hotkey clipboard quick-translate
  useEffect(() => {
    return window.localTranslate.onQuickTranslate((clipText) => {
      setSourceText(clipText);
      void runTranslation(clipText);
    });
  }, [runTranslation]);

  const handleStopTranslation = async () => {
    if (activeRequestIdRef.current) {
      await window.localTranslate.abortTranslation(activeRequestIdRef.current);
    }
  };

  const handleSwapLanguages = () => {
    if (sourceLang === 'auto') {
      // If auto, flip target into source and pick Korean/English as new target
      const nextSource = targetLang;
      const nextTarget = targetLang === 'ko' ? 'en' : 'ko';
      setSourceLang(nextSource);
      setTargetLang(nextTarget);
    } else {
      setSourceLang(targetLang);
      setTargetLang(sourceLang);
    }
    if (translatedText.trim()) {
      setSourceText(translatedText);
      setTranslatedText('');
    }
  };

  const handleCopyOutput = async () => {
    if (!translatedText) return;
    await window.localTranslate.writeClipboard(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleOpenTextFile = async () => {
    const file = await window.localTranslate.openTextFile();
    if (file) {
      setSourceText(file.content);
      setTranslatedText('');
    }
  };

  const handleSaveTranslated = async () => {
    if (!translatedText.trim()) return;
    await window.localTranslate.saveTextFile(translatedText, `translated-${targetLang}.md`);
  };

  const handleDropFile = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const text = await file.text();
    setSourceText(text);
    setTranslatedText('');
  };

  const handleActivateModel = async (modelId: string) => {
    setErrorBanner(null);
    await window.localTranslate.startEngine(modelId);
    const updatedSettings = await window.localTranslate.getSettings();
    setSettings(updatedSettings);
  };

  const handleImportLocalModel = async () => {
    try {
      const imported = await window.localTranslate.importModelDialog();
      if (imported) {
        await refreshModels();
        setIsFirstRun(false);
        await handleActivateModel(imported.id);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStartDownload = async (modelId: string) => {
    try {
      await window.localTranslate.downloadModel(modelId);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownloadEngine = async (backend: ActiveBackend) => {
    try {
      const updatedHw = await window.localTranslate.downloadEngineBackend(backend);
      setHardware(updatedHw);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const enabledGlossaryCount = glossary.filter((g) => g.enabled).length;

  const backendColor =
    engineStatus.activeBackend === 'cuda'
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
      : engineStatus.activeBackend === 'vulkan'
        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
        : 'border-sky-500/40 bg-sky-500/15 text-sky-300';

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-800/90 bg-slate-900/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
            <Languages className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-white">LocalTranslate</h1>
              <span className="rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                OFFLINE LLM
              </span>
              {runtimeInfo?.isPortable && (
                <span
                  title={`포터블 데이터 경로: ${runtimeInfo.dataDir}`}
                  className="rounded-full border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-300"
                >
                  PORTABLE
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center Engine Status & Quick Model Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-1.5">
            {engineStatus.state === 'starting' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
            ) : engineStatus.state === 'ready' ? (
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            ) : engineStatus.state === 'error' ? (
              <span className="h-2 w-2 rounded-full bg-red-400" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-slate-500" />
            )}

            {installedModels.length > 0 ? (
              <select
                value={engineStatus.activeModelId ?? settings?.activeModelId ?? ''}
                onChange={(e) => {
                  if (e.target.value) void handleActivateModel(e.target.value);
                }}
                disabled={engineStatus.state === 'starting'}
                className="max-w-[220px] bg-transparent text-xs font-medium text-slate-200 focus:outline-none"
              >
                {!engineStatus.activeModelId && <option value="">모델 선택...</option>}
                {installedModels.map((m) => (
                  <option key={m.id} value={m.id} className="bg-slate-900 text-slate-100">
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => setShowModelsModal(true)}
                className="text-xs font-medium text-amber-300 hover:underline"
              >
                모델 미설치 — 클릭하여 다운로드
              </button>
            )}

            {engineStatus.state === 'ready' && engineStatus.activeBackend && (
              <span
                className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${backendColor}`}
              >
                <Zap className="h-2.5 w-2.5" />
                {engineStatus.activeBackend}
              </span>
            )}
            {engineStatus.state === 'starting' && (
              <span className="text-[11px] text-blue-300">
                {engineStatus.activeBackend?.toUpperCase()} 로딩 중...
              </span>
            )}
          </div>
        </div>

        {/* Right Toolbar */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowModelsModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
          >
            <HardDrive className="h-3.5 w-3.5 text-blue-400" />
            모델 관리
          </button>
          <button
            onClick={() => setShowGlossaryModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
          >
            <BookOpen className="h-3.5 w-3.5 text-emerald-400" />
            용어집
            {enabledGlossaryCount > 0 && (
              <span className="rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-semibold text-emerald-300">
                {enabledGlossaryCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowHistoryDrawer(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
          >
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            기록
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
            title="엔진 및 앱 설정"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Fallback or Error Notification Banner */}
      {(errorBanner || engineStatus.fallbackNotice) && (
        <div
          className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs ${
            errorBanner
              ? 'border-red-500/30 bg-red-950/50 text-red-200'
              : 'border-amber-500/30 bg-amber-950/40 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="whitespace-pre-line">{errorBanner ?? engineStatus.fallbackNotice}</span>
          </div>
          {errorBanner && (
            <button
              onClick={() => setErrorBanner(null)}
              className="text-xs underline opacity-80 hover:opacity-100"
            >
              닫기
            </button>
          )}
        </div>
      )}

      {/* Tone & Translation Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/40 px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-slate-400">문체:</span>
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setTone(opt.id)}
              title={opt.description}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                tone === opt.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setUseGlossary((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              useGlossary
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-800 bg-slate-900 text-slate-500'
            }`}
            title="원문에 등장하는 등록 용어를 자동 주입합니다"
          >
            <BookOpen className="h-3.5 w-3.5" />
            용어집 적용
          </button>

          <button
            onClick={() => setPreserveCodeBlocks((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              preserveCodeBlocks
                ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
                : 'border-slate-800 bg-slate-900 text-slate-500'
            }`}
            title="마크다운 코드 블록(```)을 번역하지 않고 원형 그대로 보존합니다"
          >
            <Code2 className="h-3.5 w-3.5" />
            코드블록 보존
          </button>

          <button
            onClick={() => setShowCustomInstruction((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              showCustomInstruction || customInstruction.trim()
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            추가 지침
          </button>

          <button
            onClick={() => void handleOpenTextFile()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <FileUp className="h-3.5 w-3.5" />
            파일 열기 (.txt/.md)
          </button>
        </div>
      </div>

      {/* Expandable Custom Instruction Input */}
      {showCustomInstruction && (
        <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            <input
              type="text"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="추가 번역 지침 입력 (예: '해요체로 통일해줘', '고유명사는 영어 원문을 괄호로 병기해줘')"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            {customInstruction && (
              <button
                onClick={() => setCustomInstruction('')}
                className="text-xs text-slate-400 hover:text-white"
              >
                지우기
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main 2-Pane Split Workspace */}
      <main className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-slate-800 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {/* Source Pane */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={(e) => void handleDropFile(e)}
          className={`relative flex min-h-0 flex-col bg-slate-950 ${
            isDraggingFile ? 'ring-2 ring-blue-500 ring-inset' : ''
          }`}
        >
          {/* Source Language Header */}
          <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white focus:border-blue-500 focus:outline-none"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>

              <button
                onClick={handleSwapLanguages}
                className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
                title="원문/대상 언어 전환"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {sourceText && (
                <button
                  onClick={() => {
                    setSourceText('');
                    setTranslatedText('');
                    setLastStats(null);
                  }}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-white"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  비우기
                </button>
              )}
            </div>
          </div>

          {/* Source Textarea */}
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void runTranslation();
              }
            }}
            placeholder="번역할 텍스트를 입력하거나 붙여넣으세요. (.txt / .md 파일을 이곳에 드래그 앤 드롭할 수도 있습니다)&#10;&#10;단축키: Ctrl + Enter 로 즉시 번역"
            className="min-h-0 flex-1 resize-none bg-transparent p-5 text-[15px] leading-relaxed text-slate-100 placeholder-slate-600 focus:outline-none"
          />

          {/* Source Footer Bar */}
          <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-900/30 px-4 py-2.5">
            <div className="text-xs text-slate-500">
              {sourceText.length.toLocaleString()}자 ·{' '}
              {sourceText ? sourceText.split(/\r?\n/).length : 0}줄
              {settings && sourceText.length > settings.chunkSize && (
                <span className="ml-2 text-blue-400">
                  (긴 글 자동 분할 및 문맥 유지 활성)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isTranslating ? (
                <button
                  onClick={() => void handleStopTranslation()}
                  className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-500"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  번역 중단
                </button>
              ) : (
                <button
                  disabled={!sourceText.trim() || engineStatus.state !== 'ready'}
                  onClick={() => void runTranslation()}
                  className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  번역하기 (Ctrl+Enter)
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Target / Output Pane */}
        <section className="flex min-h-0 flex-col bg-slate-900/25">
          {/* Target Language Header */}
          <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white focus:border-blue-500 focus:outline-none"
              >
                {LANGUAGES.filter((l) => l.allowAsTarget).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>

              {isTranslating && chunkProgress && (
                <div className="flex items-center gap-2 text-xs text-blue-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>
                    {chunkProgress.total > 1
                      ? `청크 ${chunkProgress.current} / ${chunkProgress.total} 번역 중...`
                      : '실시간 스트리밍 번역 중...'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                disabled={!translatedText}
                onClick={() => void handleCopyOutput()}
                className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:opacity-40"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    복사됨
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    복사
                  </>
                )}
              </button>
              <button
                disabled={!translatedText}
                onClick={() => void handleSaveTranslated()}
                className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5" />
                저장
              </button>
            </div>
          </div>

          {/* Chunk Progress Bar */}
          {isTranslating && chunkProgress && chunkProgress.total > 1 && (
            <div className="h-1 w-full bg-slate-800">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{
                  width: `${Math.round((chunkProgress.current / chunkProgress.total) * 100)}%`,
                }}
              />
            </div>
          )}

          {/* Output Textarea */}
          <textarea
            ref={outputRef}
            readOnly
            value={translatedText}
            placeholder={
              engineStatus.state === 'starting'
                ? '로컬 LLM 모델을 GPU/메모리에 적재하는 중입니다...'
                : '번역 결과가 실시간 스트리밍으로 표시됩니다.'
            }
            className="min-h-0 flex-1 resize-none bg-transparent p-5 text-[15px] leading-relaxed text-blue-50 placeholder-slate-600 focus:outline-none"
          />

          {/* Output Footer Stats */}
          <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-900/30 px-4 py-2.5 text-xs text-slate-500">
            <div>
              {translatedText.length.toLocaleString()}자
              {lastStats && (
                <span className="ml-2 text-slate-400">
                  · {(lastStats.elapsedMs / 1000).toFixed(1)}초 · {lastStats.tokensGenerated}토큰
                  {lastStats.chunksProcessed > 1 ? ` · ${lastStats.chunksProcessed}개 청크` : ''}
                </span>
              )}
            </div>
            {(isTranslating || lastStats) && liveTps > 0 && (
              <span className="font-mono text-xs font-medium text-emerald-400">
                {liveTps.toFixed(1)} tok/s
              </span>
            )}
          </div>
        </section>
      </main>

      {/* Bottom Status Bar */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950 px-4 py-1.5 text-[11px] text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            100% 로컬 오프라인 추론 (외부 API 미사용)
          </span>
          {hardware?.primaryGpu && (
            <span className="hidden sm:inline text-slate-500">
              GPU: {hardware.primaryGpu.name} ({(hardware.primaryGpu.vramMB / 1024).toFixed(0)} GB)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-slate-500">
          {settings?.globalShortcut && (
            <span>
              클립보드 즉시 번역:{' '}
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                {settings.globalShortcut}
              </kbd>
            </span>
          )}
        </div>
      </footer>

      {/* Modals & Drawers */}
      <ModelManagerModal
        isOpen={showModelsModal}
        isFirstRun={isFirstRun}
        runtimeInfo={runtimeInfo}
        hardware={hardware}
        catalog={catalog}
        installedModels={installedModels}
        engineStatus={engineStatus}
        downloads={downloads}
        engineDownloads={engineDownloads}
        onClose={() => {
          setShowModelsModal(false);
          setIsFirstRun(false);
        }}
        onRefreshModels={async () => {
          await refreshModels();
        }}
        onActivateModel={handleActivateModel}
        onStartDownload={handleStartDownload}
        onPauseDownload={(id) => window.localTranslate.pauseDownload(id)}
        onCancelDownload={(id) => window.localTranslate.cancelDownload(id)}
        onDownloadEngine={handleDownloadEngine}
        onCancelEngineDownload={(backend) => window.localTranslate.cancelEngineDownload(backend)}
        onImportLocalModel={handleImportLocalModel}
        onDeleteModel={async (id) => {
          const next = await window.localTranslate.deleteModel(id);
          setInstalledModels(next);
        }}
      />

      <GlossaryModal
        isOpen={showGlossaryModal}
        entries={glossary}
        onClose={() => setShowGlossaryModal(false)}
        onSave={async (next) => {
          const saved = await window.localTranslate.saveGlossary(next);
          setGlossary(saved);
        }}
        onImport={async () => {
          const imported = await window.localTranslate.importGlossary();
          if (imported) setGlossary(imported);
        }}
        onExport={async () => {
          await window.localTranslate.exportGlossary();
        }}
      />

      <HistoryDrawer
        isOpen={showHistoryDrawer}
        entries={history}
        onClose={() => setShowHistoryDrawer(false)}
        onSelect={(entry) => {
          setSourceLang(entry.sourceLang);
          setTargetLang(entry.targetLang);
          setTone(entry.tone);
          setSourceText(entry.sourceText);
          setTranslatedText(entry.translatedText);
        }}
        onDelete={async (id) => {
          const next = await window.localTranslate.deleteHistory(id);
          setHistory(next);
        }}
        onClearAll={async () => {
          const next = await window.localTranslate.clearHistory();
          setHistory(next);
        }}
      />

      {settings && (
        <SettingsModal
          isOpen={showSettingsModal}
          settings={settings}
          hardware={hardware}
          onClose={() => setShowSettingsModal(false)}
          onSave={async (patch) => {
            const res = await window.localTranslate.updateSettings(patch);
            setSettings(res.settings);
            setPreserveCodeBlocks(res.settings.preserveCodeBlocks);
            return { shortcutRegistered: res.shortcutRegistered };
          }}
          onChooseModelsDir={async () => {
            const dir = await window.localTranslate.chooseModelsDir();
            if (dir) {
              const updated = await window.localTranslate.getSettings();
              setSettings(updated);
              await refreshModels();
            }
          }}
        />
      )}
    </div>
  );
}
