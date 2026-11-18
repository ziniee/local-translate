import { describe, expect, it } from 'vitest';
import {
  computeBackendOrder,
  parseNvidiaSmiOutput,
  recommendHardwareConfig,
} from '../src/main/hardware';

describe('hardware detection and recommendation', () => {
  it('parses RTX 3060 12GB nvidia-smi output accurately', () => {
    const gpus = parseNvidiaSmiOutput('NVIDIA GeForce RTX 3060, 12288, 616.92\n');
    expect(gpus).toEqual([
      {
        name: 'NVIDIA GeForce RTX 3060',
        vramMB: 12288,
        driverVersion: '616.92',
        vendor: 'nvidia',
      },
    ]);
  });

  it('orders backends CUDA -> Vulkan -> CPU for NVIDIA GPU in auto mode', () => {
    const order = computeBackendOrder('auto', ['cuda', 'vulkan', 'cpu'], {
      name: 'NVIDIA GeForce RTX 3060',
      vramMB: 12288,
      vendor: 'nvidia',
    });
    expect(order).toEqual(['cuda', 'vulkan', 'cpu']);
  });

  it('orders backends Vulkan -> CPU for AMD GPU in auto mode', () => {
    const order = computeBackendOrder('auto', ['cuda', 'vulkan', 'cpu'], {
      name: 'AMD Radeon RX 7800 XT',
      vramMB: 16384,
      vendor: 'amd',
    });
    expect(order).toEqual(['vulkan', 'cpu']);
  });

  it('recommends Gemma 3 12B with CUDA + 99 GPU layers + 8K ctx on RTX 3060 12GB / 32GB RAM', () => {
    const rec = recommendHardwareConfig(
      { name: 'NVIDIA GeForce RTX 3060', vramMB: 12288, vendor: 'nvidia' },
      32768,
      ['cuda', 'vulkan', 'cpu'],
    );
    expect(rec.recommendedBackend).toBe('cuda');
    expect(rec.missingRecommendedBackend).toBeNull();
    expect(rec.recommendedModelId).toBe('gemma-3-12b-it-q4km');
    expect(rec.recommendedGpuLayers).toBe(99);
    expect(rec.recommendedContextSize).toBe(8192);
  });

  it('flags missing CUDA backend for on-demand download on lightweight portable builds', () => {
    const rec = recommendHardwareConfig(
      { name: 'NVIDIA GeForce RTX 3060', vramMB: 12288, vendor: 'nvidia' },
      32768,
      ['vulkan', 'cpu'],
    );
    expect(rec.recommendedBackend).toBe('vulkan');
    expect(rec.missingRecommendedBackend).toBe('cuda');
    expect(rec.recommendedModelId).toBe('gemma-3-12b-it-q4km');
  });

  it('falls back to CPU and lightweight model when no GPU is present', () => {
    const rec = recommendHardwareConfig(null, 16384, ['cpu']);
    expect(rec.recommendedBackend).toBe('cpu');
    expect(rec.missingRecommendedBackend).toBeNull();
    expect(rec.recommendedModelId).toBe('gemma-3-4b-it-q4km');
    expect(rec.recommendedGpuLayers).toBe(0);
  });
});
