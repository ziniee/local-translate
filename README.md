# LocalTranslate — 오프라인 로컬 LLM 내장 Windows 번역기

외부 API 키나 인터넷 연결 없이 **단일 Windows 데스크톱 앱**에서 완결되는 로컬 LLM 번역기입니다.
`llama.cpp` 공식 추론 엔진(`llama-server.exe`)을 앱 내부 사이드카로 내장하고, **CUDA → Vulkan → CPU** 하드웨어 가속 자동 분기 및 폴백을 지원합니다.

## 주요 기능

1. **완전 오프라인 로컬 LLM 추론 (Type A 내장형)**
   - 외부 API 호출 없이 `127.0.0.1` 임시 포트에서 격리된 `llama-server.exe` 프로세스로 동작
   - Ollama 등 별도 런타임 설치 불필요
2. **하드웨어 가속 자동 감지 및 폴백 (`CUDA → Vulkan → CPU`)**
   - RTX 3060 12GB 등 NVIDIA GPU 감지 시 CUDA 12.4 + 전체 레이어 오프로드(`-ngl 99`) + Flash Attention 자동 적용
   - AMD/Intel GPU는 Vulkan, 미지원/오류 시 CPU(AVX2)로 자동 폴백
3. **번역 품질 특화 파이프라인**
   - 번역문만 출력하도록 고정된 시스템 프롬프트 + 문체 프리셋(자연스럽게 / 격식체 / 기술 문서 / 구어체 / 직역) + 사용자 추가 지침
   - **사용자 정의 용어집(Glossary)**: 원문에 등장하는 용어만 자동 감지해 프롬프트에 동적 주입, JSON 가져오기/내보내기 지원
   - **긴 글 스마트 분할 & 문맥 유지**: 문단/문장 경계 기준 자동 청킹, 마크다운 코드 블록(```` ``` ````) 원형 보존, 직전 청크 슬라이딩 컨텍스트 전달
   - **실시간 스트리밍 출력**: 토큰 단위 출력, 중단 버튼, 실시간 생성 속도(`tok/s`) 및 청크 진행률 표시
4. **온디맨드 GGUF 모델 관리**
   - PC 사양(VRAM/RAM)에 맞는 추천 GGUF 카탈로그 제공 (RTX 3060 12GB 주력 추천: `Gemma 3 12B IT Q4_K_M`)
   - 이어받기(Range), 일시정지/취소, SHA-256 무결성 검증, 로컬 `.gguf` 파일 직접 가져오기 지원
5. **Windows 데스크톱 통합**
   - 시스템 트레이 상주 + 글로벌 단축키(기본 `Alt+Shift+T`)로 클립보드 텍스트 즉시 번역
   - `.txt` / `.md` 파일 드래그 앤 드롭 번역 및 결과 저장, 번역 이력 검색

## 개발 및 실행

```bash
# 1. 의존성 설치
pnpm install

# 2. llama.cpp Windows 엔진 바이너리(CUDA 12.4 / Vulkan / CPU) 준비
pnpm fetch:engines

# 3. 개발 모드 실행
pnpm dev

# 4. 프로덕션 빌드 및 실행
pnpm start

# 5. 단위 테스트 및 타입 체크
pnpm typecheck
pnpm test
```

## 다른 PC 배포용 패키징 (포터블 / 설치형)

```bash
# 1. 경량 포터블 패키지 생성 (추천: Vulkan+CPU 기본 내장, CUDA 및 모델은 앱 내 1클릭 다운로드)
#    -> release/LocalTranslate-Portable/ 폴더 및 release/LocalTranslate-1.0.0-win-x64-portable.zip
pnpm build:portable

# 2. 현재 PC의 .gguf 모델까지 포함한 오프라인 USB 포터블 패키지 생성
pnpm build:portable:with-models

# 3. CUDA 12.4 + Vulkan + CPU 전체 엔진 포함 포터블 패키지 생성 (폐쇄망 NVIDIA PC용)
pnpm build:portable:full

# 4. Windows 일반 설치 프로그램(NSIS .exe) 생성
pnpm build:installer

# 5. GitHub Releases 업로드용 일괄 빌드 (Portable ZIP + Setup EXE + SHA256SUMS.txt)
pnpm build:github
```

### GitHub Actions 자동 빌드 및 Releases 배포

이 저장소에는 [`.github/workflows/release.yml`](.github/workflows/release.yml) 워크플로우가 포함되어 있습니다.
대용량 바이너리(`resources/engines`, `release/`)는 `.gitignore`로 제외되어 GitHub 저장소에는 가벼운 소스 코드만 올라가며, **태그 푸시 또는 수동 실행 시 GitHub Actions(`windows-latest`)가 자동으로 포터블 ZIP·설치 파일·`SHA256SUMS.txt`를 빌드해 GitHub Releases에 업로드**합니다.

```powershell
# 최초 GitHub 저장소 연결 예시
git init
git add .
git commit -m "Initial commit: LocalTranslate"
git branch -M main
git remote add origin https://github.com/<내아이디>/<저장소이름>.git
git push -u origin main

# v1.0.0 태그 푸시 -> GitHub Releases 자동 생성 및 배포 파일 업로드
git tag v1.0.0
git push origin v1.0.0
```

> 태그를 만들지 않고 테스트 빌드만 하려면 GitHub 저장소의 **Actions → Build & Release Windows Portable → Run workflow** 버튼으로 수동 실행해 Artifacts에서 바로 다운로드할 수 있습니다.

### 포터블 모드 동작 원리
* 실행 파일(`LocalTranslate.exe`) 옆에 `portable.flag` 또는 `data/` 폴더가 있으면 자동으로 **포터블 모드(`PORTABLE`)**로 실행됩니다.
* 설정, 용어집, 번역 기록, 다운로드한 `.gguf` 모델, 추가 설치한 추론 엔진(예: CUDA)이 모두 `data/` 폴더 안에 저장되므로 폴더째 USB나 다른 PC로 복사해도 그대로 동작합니다.
* 배포 용량을 줄이기 위해 `data/models/`를 비워 배포한 경우에도, 다른 PC에서 첫 실행 시 **모델과 필요한 가속 엔진(CUDA/Vulkan/CPU)을 앱 안에서 1클릭으로 자동 다운로드**할 수 있습니다.
