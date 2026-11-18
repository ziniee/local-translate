import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type {
  ActiveBackend,
  AppRuntimeInfo,
  EngineDownloadProgress,
  EngineStatus,
  HardwareInfo,
  InstalledModel,
  ModelCatalogItem,
  ModelDownloadProgress,
} from '../../shared/types';
import { formatBytes, formatEta } from '../utils/format';

interface Props {
  isOpen: boolean;
  isFirstRun: boolean;
  runtimeInfo: AppRuntimeInfo | null;
  hardware: HardwareInfo | null;
  catalog: ModelCatalogItem[];
  installedModels: InstalledModel[];
  engineStatus: EngineStatus;
  downloads: Record<string, ModelDownloadProgress>;
  engineDownloads: Partial<Record<ActiveBackend, EngineDownloadProgress>>;
  onClose: () => void;
  onRefreshModels: () => Promise<void>;
  onActivateModel: (modelId: string) => Promise<void>;
  onStartDownload: (modelId: string) => Promise<void>;
  onPauseDownload: (modelId: string) => Promise<void>;
  onCancelDownload: (modelId: string) => Promise<void>;
  onDownloadEngine: (backend: ActiveBackend) => Promise<void>;
  onCancelEngineDownload: (backend: ActiveBackend) => Promise<void>;
  onImportLocalModel: () => Promise<void>;
  onDeleteModel: (modelId: string) => Promise<void>;
}

export const ModelManagerModal: React.FC<Props> = ({
  isOpen,
  isFirstRun,
  runtimeInfo,
  hardware,
  catalog,
  installedModels,
  engineStatus,
  downloads,
  engineDownloads,
  onClose,
  onRefreshModels,
  onActivateModel,
  onStartDownload,
  onPauseDownload,
  onCancelDownload,
  onDownloadEngine,
  onCancelEngineDownload,
  onImportLocalModel,
  onDeleteModel,
}) => {
  const [partialBytesMap, setPartialBytesMap] = useState<Record<string, number>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    (async () => {
      const entries: Record<string, number> = {};
      for (const item of catalog) {
        entries[item.id] = await window.localTranslate.getPartialBytes(item.id);
      }
      if (active) setPartialBytesMap(entries);
    })();
    return () => {
      active = false;
    };
  }, [isOpen, catalog, downloads]);

  if (!isOpen) return null;

  const installedById = new Map(installedModels.map((m) => [m.id, m]));
  const customModels = installedModels.filter((m) => m.isCustom);

  const handleActivate = async (modelId: string) => {
    setBusyAction(modelId);
    try {
      await onActivateModel(modelId);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <HardDrive className="h-5 w-5 text-blue-400" />
              {isFirstRun ? '로컬 번역 모델 초기 설정' : '로컬 LLM 모델 관리'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              최초 1회 `.gguf` 모델을 내려받거나 로컬 파일을 불러오면 이후 인터넷 없이 100% 오프라인으로 동작합니다.
            </p>
          </div>
          {!isFirstRun && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              aria-label="닫기"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Hardware Diagnostics & Engine Backends Card */}
          {hardware && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
                    <Cpu className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                      <span>감지된 내 PC 하드웨어</span>
                      {runtimeInfo?.isPortable && (
                        <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                          PORTABLE 모드
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {hardware.primaryGpu
                        ? `${hardware.primaryGpu.name} (${(hardware.primaryGpu.vramMB / 1024).toFixed(1)} GB VRAM)`
                        : '내장/CPU 환경'}
                      <span className="mx-2 text-slate-600">·</span>
                      RAM {(hardware.totalRamMB / 1024).toFixed(0)} GB
                      <span className="mx-2 text-slate-600">·</span>
                      CPU {hardware.cpuCores}스레드
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['cuda', 'vulkan', 'cpu'] as ActiveBackend[]).map((backend) => {
                    const installed = hardware.availableEngines.includes(backend);
                    const dl = engineDownloads[backend];
                    const isBusy =
                      dl?.state === 'fetching_release' ||
                      dl?.state === 'downloading' ||
                      dl?.state === 'extracting';

                    if (installed) {
                      return (
                        <span
                          key={backend}
                          className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {backend.toUpperCase()} 준비됨
                        </span>
                      );
                    }
                    return (
                      <button
                        key={backend}
                        disabled={isBusy}
                        onClick={() => void onDownloadEngine(backend)}
                        className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:border-blue-500/60 hover:bg-blue-600/20 hover:text-blue-200 disabled:opacity-50"
                        title={`${backend.toUpperCase()} 추론 엔진 온디맨드 다운로드`}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {backend.toUpperCase()} 설치
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Prompt banner if a faster recommended backend (e.g. CUDA on NVIDIA) is missing */}
              {hardware.missingRecommendedBackend && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-500/30 bg-indigo-950/30 px-3.5 py-2.5 text-xs">
                  <div className="flex items-center gap-2 text-indigo-200">
                    <Zap className="h-4 w-4 shrink-0 text-indigo-400" />
                    <span>
                      이 PC에 최적화된{' '}
                      <strong className="uppercase">{hardware.missingRecommendedBackend}</strong>{' '}
                      가속 엔진이 아직 설치되지 않았습니다. 지금 내려받으면 GPU 가속 번역이 활성화됩니다.
                    </span>
                  </div>
                  {(() => {
                    const target = hardware.missingRecommendedBackend!;
                    const dl = engineDownloads[target];
                    const busy =
                      dl?.state === 'fetching_release' ||
                      dl?.state === 'downloading' ||
                      dl?.state === 'extracting';
                    return busy ? (
                      <button
                        onClick={() => void onCancelEngineDownload(target)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:text-red-300"
                      >
                        취소
                      </button>
                    ) : (
                      <button
                        onClick={() => void onDownloadEngine(target)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {target.toUpperCase()} 엔진 다운로드
                      </button>
                    );
                  })()}
                </div>
              )}

              {/* Active Engine Download Progress Bars */}
              {(['cuda', 'vulkan', 'cpu'] as ActiveBackend[]).map((backend) => {
                const dl = engineDownloads[backend];
                if (!dl || dl.state === 'completed' || dl.state === 'cancelled') return null;
                const pct =
                  dl.totalBytes > 0 ? Math.min(100, (dl.bytesDownloaded / dl.totalBytes) * 100) : 0;
                return (
                  <div
                    key={`eng-dl-${backend}`}
                    className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-900/90 p-3"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-blue-300">
                        {backend.toUpperCase()} 엔진{' '}
                        {dl.state === 'fetching_release'
                          ? '최신 릴리스 확인 중...'
                          : dl.state === 'extracting'
                            ? '압축 해제 및 구성 중...'
                            : dl.state === 'error'
                              ? `오류: ${dl.error}`
                              : `다운로드 중 (${dl.fileLabel ?? ''})`}
                      </span>
                      {dl.state === 'downloading' && (
                        <span className="text-[11px] text-slate-400">
                          {formatBytes(dl.bytesDownloaded)} / {formatBytes(dl.totalBytes)} (
                          {formatBytes(dl.speedBytesPerSec)}/s)
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          dl.state === 'error'
                            ? 'bg-red-500'
                            : dl.state === 'extracting'
                              ? 'w-full animate-pulse bg-indigo-500'
                              : 'bg-blue-500'
                        }`}
                        style={dl.state === 'extracting' ? undefined : { width: `${pct.toFixed(1)}%` }}
                      />
                    </div>
                  </div>
                );
              })}

              {runtimeInfo?.isPortable && (
                <div className="text-[11px] text-slate-500">
                  포터블 저장 위치: <span className="font-mono text-slate-400">{runtimeInfo.dataDir}</span>{' '}
                  (폴더째 USB나 다른 PC로 복사하면 모델·엔진·용어집이 함께 이동합니다)
                </div>
              )}
            </div>
          )}

          {/* Action toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-200">추천 번역 모델 카탈로그 (GGUF)</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={onImportLocalModel}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-blue-500/50 hover:bg-slate-700"
              >
                <Plus className="h-3.5 w-3.5" />
                로컬 .gguf 파일 가져오기
              </button>
              <button
                onClick={() => window.localTranslate.openModelsFolder()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                모델 폴더 열기
              </button>
              <button
                onClick={() => void onRefreshModels()}
                className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                title="새로고침"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Curated Catalog Cards */}
          <div className="grid gap-3">
            {catalog.map((item) => {
              const installed = installedById.get(item.id);
              const dl = downloads[item.id];
              const isRecommended = hardware?.recommendedModelId === item.id;
              const isActive =
                engineStatus.activeModelId === item.id &&
                (engineStatus.state === 'ready' || engineStatus.state === 'starting');
              const partialBytes = partialBytesMap[item.id] ?? 0;

              const isDownloading = dl?.state === 'downloading';
              const isVerifying = dl?.state === 'verifying';
              const isPaused = dl?.state === 'paused' || (!isDownloading && !installed && partialBytes > 0);
              const progressPct =
                dl && dl.totalBytes > 0
                  ? Math.min(100, (dl.bytesDownloaded / dl.totalBytes) * 100)
                  : partialBytes > 0
                    ? Math.min(100, (partialBytes / item.sizeBytes) * 100)
                    : 0;

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-4 transition ${
                    isActive
                      ? 'border-blue-500/60 bg-blue-950/20'
                      : isRecommended
                        ? 'border-indigo-500/40 bg-slate-900/90'
                        : 'border-slate-800 bg-slate-900/60'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-white">{item.name}</span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
                          {item.quantization}
                        </span>
                        <span className="text-xs text-slate-400">{formatBytes(item.sizeBytes)}</span>
                        {isRecommended && (
                          <span className="flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
                            <Sparkles className="h-3 w-3" />내 PC 최적 추천
                          </span>
                        )}
                        {!isRecommended && (
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{item.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.strengths.map((s) => (
                          <span
                            key={s}
                            className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-0.5 text-[11px] text-slate-300"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Right side action controls */}
                    <div className="flex shrink-0 items-center gap-2">
                      {installed ? (
                        <>
                          {isActive ? (
                            <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300">
                              <CheckCircle2 className="h-4 w-4" />
                              {engineStatus.state === 'starting' ? '로딩 중...' : '사용 중'}
                            </span>
                          ) : (
                            <button
                              disabled={busyAction !== null}
                              onClick={() => void handleActivate(item.id)}
                              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
                            >
                              <Play className="h-3.5 w-3.5" />
                              엔진에 로드
                            </button>
                          )}
                          <button
                            onClick={() => void onDeleteModel(item.id)}
                            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
                            title="모델 삭제"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      ) : isDownloading ? (
                        <>
                          <button
                            onClick={() => void onPauseDownload(item.id)}
                            className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20"
                          >
                            <Pause className="h-3.5 w-3.5" />
                            일시정지
                          </button>
                          <button
                            onClick={() => void onCancelDownload(item.id)}
                            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition hover:text-red-400"
                            title="취소"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : isVerifying ? (
                        <span className="flex items-center gap-1.5 rounded-lg bg-indigo-500/15 px-3 py-1.5 text-xs font-medium text-indigo-300">
                          <ShieldCheck className="h-4 w-4 animate-pulse" />
                          SHA-256 검증 중...
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => void onStartDownload(item.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {isPaused ? '이어받기' : '다운로드'}
                          </button>
                          {isPaused && (
                            <button
                              onClick={() => void onCancelDownload(item.id)}
                              className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition hover:text-red-400"
                              title="임시 파일 삭제"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Download Progress Bar */}
                  {(isDownloading || isVerifying || isPaused || dl?.state === 'error') && !installed && (
                    <div className="mt-3 space-y-1.5">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full transition-all duration-300 ${
                            dl?.state === 'error'
                              ? 'bg-red-500'
                              : isVerifying
                                ? 'bg-indigo-500'
                                : isPaused
                                  ? 'bg-amber-500'
                                  : 'bg-blue-500'
                          }`}
                          style={{ width: `${progressPct.toFixed(1)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>
                          {dl?.state === 'error'
                            ? `오류: ${dl.error}`
                            : isVerifying
                              ? '다운로드 완료 — SHA-256 무결성 확인 중...'
                              : isPaused
                                ? `일시정지됨 (${formatBytes(dl?.bytesDownloaded ?? partialBytes)} / ${formatBytes(item.sizeBytes)})`
                                : `${formatBytes(dl.bytesDownloaded)} / ${formatBytes(dl.totalBytes)} (${progressPct.toFixed(1)}%)`}
                        </span>
                        {isDownloading && (
                          <span>
                            {formatBytes(dl.speedBytesPerSec)}/s · 남은 시간 {formatEta(dl.etaSeconds)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Custom Local Models Section */}
          {customModels.length > 0 && (
            <div className="space-y-2.5 pt-2">
              <h3 className="text-sm font-semibold text-slate-200">로컬에서 가져온 모델 (.gguf)</h3>
              {customModels.map((model) => {
                const isActive =
                  engineStatus.activeModelId === model.id &&
                  (engineStatus.state === 'ready' || engineStatus.state === 'starting');
                return (
                  <div
                    key={model.id}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">{model.name}</div>
                      <div className="truncate text-xs text-slate-400">
                        {formatBytes(model.sizeBytes)} · {model.filePath}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isActive ? (
                        <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          사용 중
                        </span>
                      ) : (
                        <button
                          onClick={() => void handleActivate(model.id)}
                          className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                        >
                          <Play className="h-3.5 w-3.5" />
                          엔진에 로드
                        </button>
                      )}
                      <button
                        onClick={() => void onDeleteModel(model.id)}
                        className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-red-400"
                        title="목록에서 제거"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-6 py-3">
          <span className="text-xs text-slate-400">
            설치된 모델: <strong className="text-slate-200">{installedModels.length}개</strong>
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
