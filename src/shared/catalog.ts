import type { LanguageOption, ModelCatalogItem, ToneOption } from './types';

export const LANGUAGES: LanguageOption[] = [
  { code: 'auto', label: '자동 감지', englishName: 'Auto-detect', allowAsTarget: false },
  { code: 'ko', label: '한국어', englishName: 'Korean', allowAsTarget: true },
  { code: 'en', label: '영어', englishName: 'English', allowAsTarget: true },
  { code: 'ja', label: '일본어', englishName: 'Japanese', allowAsTarget: true },
  { code: 'zh-Hans', label: '중국어 (간체)', englishName: 'Simplified Chinese', allowAsTarget: true },
  { code: 'zh-Hant', label: '중국어 (번체)', englishName: 'Traditional Chinese', allowAsTarget: true },
  { code: 'es', label: '스페인어', englishName: 'Spanish', allowAsTarget: true },
  { code: 'fr', label: '프랑스어', englishName: 'French', allowAsTarget: true },
  { code: 'de', label: '독일어', englishName: 'German', allowAsTarget: true },
  { code: 'vi', label: '베트남어', englishName: 'Vietnamese', allowAsTarget: true },
  { code: 'ru', label: '러시아어', englishName: 'Russian', allowAsTarget: true },
];

export const TONE_OPTIONS: ToneOption[] = [
  {
    id: 'natural',
    label: '자연스럽게',
    description: '원문의 의미와 뉘앙스를 살려 자연스럽고 읽기 편하게 번역합니다.',
  },
  {
    id: 'formal',
    label: '격식체 / 비즈니스',
    description: '공식 문서, 이메일, 보고서에 적합한 정중하고 격식 있는 문체로 번역합니다.',
  },
  {
    id: 'technical',
    label: '기술 문서',
    description: 'IT·공학 용어의 정확성과 간결함을 유지하며 코드·식별자를 보존합니다.',
  },
  {
    id: 'casual',
    label: '구어체 / 친근하게',
    description: '대화나 메신저, 일상 콘텐츠에 어울리는 부드러운 구어체로 번역합니다.',
  },
  {
    id: 'literal',
    label: '원문 충실 (직역)',
    description: '의역을 최소화하고 원문의 구조와 표현을 최대한 충실히 반영합니다.',
  },
];

export const MODEL_CATALOG: ModelCatalogItem[] = [
  {
    id: 'gemma-3-12b-it-q4km',
    name: 'Gemma 3 12B IT',
    filename: 'gemma-3-12b-it-Q4_K_M.gguf',
    repo: 'unsloth/gemma-3-12b-it-GGUF',
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q4_K_M.gguf',
    sizeBytes: 7300778336,
    sha256: '15b8fd9d8672cd4240c178c217ca781409291f34e353d2e913b29c7602ceb3ff',
    quantization: 'Q4_K_M',
    minVramMB: 9500,
    minRamMB: 16000,
    badge: 'RTX 3060 12GB 주력 추천',
    summary: '12GB VRAM에 전체 레이어가 적재되는 다국어 최고 품질 번역 모델입니다.',
    strengths: ['한·영·일·유럽어 고품질', '긴 문맥 일관성 우수', '12GB VRAM 100% GPU 가속'],
  },
  {
    id: 'exaone-3.5-7.8b-q4km',
    name: 'EXAONE 3.5 7.8B Instruct',
    filename: 'EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    repo: 'bartowski/EXAONE-3.5-7.8B-Instruct-GGUF',
    downloadUrl:
      'https://huggingface.co/bartowski/EXAONE-3.5-7.8B-Instruct-GGUF/resolve/main/EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    sizeBytes: 4770650304,
    sha256: '3224531828df45db7834521a7310cd4bbd9c998168ba64fbee81d9be0c2cdee0',
    quantization: 'Q4_K_M',
    minVramMB: 6000,
    minRamMB: 12000,
    badge: '한↔영 특화 · 고속',
    summary: 'LG AI Research의 한국어/영어 특화 모델로 자연스러운 한국어 표현력이 뛰어납니다.',
    strengths: ['자연스러운 한국어 어순', '빠른 토큰 생성 속도', 'VRAM 6GB+ 여유 실행'],
  },
  {
    id: 'qwen-2.5-7b-q4km',
    name: 'Qwen 2.5 7B Instruct',
    filename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    repo: 'bartowski/Qwen2.5-7B-Instruct-GGUF',
    downloadUrl:
      'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    sizeBytes: 4683074240,
    sha256: '65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423',
    quantization: 'Q4_K_M',
    minVramMB: 6000,
    minRamMB: 12000,
    badge: '한·영·중·일 / 기술문서',
    summary: '동아시아 언어 및 개발·기술 문서, 마크다운/코드 포함 번역에 강한 균형형 모델입니다.',
    strengths: ['한·영·중·일 강점', '기술·개발 문서 정확도', 'VRAM 6GB+ 고속 동작'],
  },
  {
    id: 'gemma-3-4b-it-q4km',
    name: 'Gemma 3 4B IT',
    filename: 'gemma-3-4b-it-Q4_K_M.gguf',
    repo: 'unsloth/gemma-3-4b-it-GGUF',
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf',
    sizeBytes: 2489894016,
    sha256: '04a43a22e8d2003deda5acc262f68ec1005fa76c735a9962a8c77042a74a7d19',
    quantization: 'Q4_K_M',
    minVramMB: 3500,
    minRamMB: 8000,
    badge: '경량 · 저사양/CPU 겸용',
    summary: '저사양 GPU나 CPU 전용 Windows PC에서도 쾌적하게 동작하는 경량 다국어 모델입니다.',
    strengths: ['2.5GB 가벼운 용량', 'Vulkan/CPU 폴백 최적', '빠른 응답 속도'],
  },
  {
    id: 'qwen-2.5-1.5b-q4km',
    name: 'Qwen 2.5 1.5B Instruct',
    filename: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
    downloadUrl:
      'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    sizeBytes: 986048768,
    sha256: '1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370',
    quantization: 'Q4_K_M',
    minVramMB: 1800,
    minRamMB: 4000,
    badge: '초경량 · 즉시 테스트 (~1GB)',
    summary: '약 1GB 미만으로 가장 빠르게 받아 테스트하거나 초저사양 PC에서 실행할 수 있습니다.',
    strengths: ['1GB 미만 초경량', '초고속 토큰 생성', 'CPU 전용 노트북 호환'],
  },
];

export function getLanguageByCode(code: string): LanguageOption | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
