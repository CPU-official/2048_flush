# 기술 스택

Windows / macOS 전용 Electron 데스크톱 2D 2048 게임. 화려한 VFX와 게임 효과(파티클, 셰이더, 화면 연출)가 핵심이므로, 스택은 "VFX를 얼마나 쉽고 빠르게 얹을 수 있는가"를 기준으로 선택했다.

화면/규칙은 [overview-project.md](overview-project.md), 서버/네트워크는 [networking.md](networking.md)를 본다.

## 선택한 스택

| 영역 | 선택 | 역할 |
|---|---|---|
| 렌더러 | **PixiJS v8** | WebGL/WebGPU 기반 2D 렌더링, 필터, 커스텀 셰이더 |
| 트윈/연출 | **GSAP** | 타일 이동, 스쿼시&스트레치, 화면 흔들림, 타임라인 연출 |
| 파티클 | **@pixi/particle-emitter** | 머지 버스트, 트레일, 콤보 이펙트 (필요시 직접 구현) |
| 사운드 | **Howler.js** | 효과음, 콤보에 따른 피치 변화 |
| 네트워크 | **ws** (서버/클라이언트) | LAN WebSocket |
| 언어 | **TypeScript** | 타입 안정성 |
| 빌드/개발 | **Vite** | 빠른 HMR (이펙트 수치 조정 반복에 유리) |
| 테스트 | **Vitest** | `core` 단위/리플레이 테스트 |

## 선택 이유

- **PixiJS v8**: 파티클이 수천 개여도 60fps를 유지한다. 블룸, 글로우, 디스플레이스먼트(쇼크웨이브), 색수차, CRT 등 필터를 지원하고 GLSL 커스텀 셰이더 작성이 자유롭다. 번들이 Phaser보다 가볍다.
- **GSAP**: 타임라인과 이징이 강력해서 머지 연출, 슬로모션, 줌 펀치, 숫자 카운트업을 간결하게 구현할 수 있다.
- **Howler.js**: 연속 머지 시 음정을 올리는 식의 콤보 피드백 구현이 쉽다.
- **Vite + TS + Vitest**: 설정이 가볍고 개발 서버 반응이 빠르다. Vitest는 Vite 설정을 그대로 쓴다.
- **Phaser가 아닌 이유**: 올인원이지만 2048에는 과하고, 셰이더 자유도는 Pixi가 높다.

## 아키텍처 원칙

게임 로직과 렌더링/VFX를 분리한다.

- `core`는 입력(방향)을 받아 "이동/머지 결과 이벤트 목록"을 반환한다. 렌더링, 시간, 네트워크에 의존하지 않는다.
- `render`와 `vfx`는 그 이벤트를 구독해 연출만 담당한다.
- 제한 시간 타이머, 계정 세션, 게임 흐름(종료 팝업, 60초 무입력 처리)은 `game`에 둔다.
- 이펙트를 아무리 추가해도 로직이 오염되지 않고, `core`는 단위 테스트가 쉽다.

## 폴더 구조

```
src/
├── core/        # 순수 TS 게임 로직 (보드, 이동, 머지, 점수, mulberry32 RNG) + 테스트
├── game/        # 제한 시간 타이머(S자 곡선), 계정 세션, 게임 흐름, 대결 흐름
├── render/      # PixiJS 씬, 타일 스프라이트, 보드 렌더링
├── vfx/         # 파티클, 셰이더, 필터, 화면 흔들림 등 이펙트
├── audio/       # Howler 기반 사운드 매니저
├── net/         # 클라이언트 프로토콜, 접속/재접속, 오프라인 큐, 메시지 타입(서버와 공유)
├── constants.ts # 조정 가능한 값(제한 시간 유예, 닉네임 길이, 무입력 시간, 대결 시간 등). 서버/클라이언트 공용
├── ui/          # 화면 (시작, 랭킹, 게임 HUD, 대결, 설정) + console/ (슬래시 커맨드 입력창)
├── assets/      # demo-log.json (시작 화면 데모용 이동 로그) 등
└── main.ts
electron/
├── main.ts      # 메인 프로세스 (창 생성, 네이티브 기능, 서버 시작/중지)
├── preload.ts   # 렌더러에 노출할 최소 API
└── server/      # ws 서버, 대결 매칭/중계, 랭킹 저장소(load/save), 서버 설정
```

## VFX 아이디어 목록

- 머지 시 쇼크웨이브 링(displacement filter) + 파티클 버스트
- 타일 값별 색상 글로우 (블룸 필터)
- 고수치 타일(512 이상) 생성 시 슬로모션, 줌 펀치, 화면 흔들림
- 연속 머지 콤보에 따라 강해지는 이펙트와 사운드 피치
- 점수에 반응하는 배경 셰이더 (흐르는 그라디언트, 별 필드)
- 2048 달성 시 전체 화면 불꽃/컨페티 연출
- 이동 방향으로 보드 튕김, 남은 시간에 따른 붉은 비네팅 (게임 규칙 연출)

## 참고

- 성능 목표: 행사용 Windows/macOS PC에서 60fps. 파티클 수와 필터 개수에 상한을 두고, 저사양 PC에서는 VFX on/off 설정(이 PC 로컬)으로 끈다.

## 데스크톱 배포 (Electron)

### 구성

| 영역 | 선택 | 비고 |
|---|---|---|
| 데스크톱 셸 | **Electron** | Chromium 번들 → 두 OS에서 WebGL/셰이더 결과가 동일 |
| Vite 연동 | **vite-plugin-electron** (또는 electron-vite) | main/preload/renderer를 Vite로 빌드, 렌더러 HMR |
| 패키징 | **electron-builder** | Windows: NSIS 설치본 또는 포터블 exe, macOS: dmg |

### Electron을 선택한 이유 (Tauri 대비)

- Tauri는 OS별 시스템 웹뷰(WebView2 / WKWebView)를 쓰므로 WebGL 성능과 셰이더 동작이 플랫폼마다 달라질 수 있다.
- VFX가 핵심이므로 렌더링 결과의 일관성이 우선이다.
- Rust 툴체인이 불필요하다.

### 개발 워크플로 (실시간 테스트)

- **렌더러(`src/`)**: Vite dev server를 Electron 창이 로드하므로 저장 시 HMR로 즉시 반영된다.
- **main 프로세스**: 수정 시 앱이 자동 재시작된다. preload는 창 리로드로 반영되는 경우가 많다. 게임 로직과 VFX는 대부분 렌더러에 있어 재시작이 필요한 일은 드물다.
- **DevTools**: `Ctrl/Cmd+Opt+I`로 Chromium DevTools(콘솔, 프로파일러, GPU 성능) 사용.
- **브라우저 병행(개발 전용)**: Vite dev server는 일반 브라우저에서도 열린다. VFX 반복 작업은 브라우저 탭에서, 데스크톱 전용 기능(파일 저장, 서버 모드 등)만 Electron에서 확인한다. 배포 대상은 아니다.
- **VFX 튜닝 UI**: dev 빌드에만 `lil-gui` 또는 `tweakpane`을 붙여 파티클/셰이더 값을 슬라이더로 실시간 조정한다.
- **상태 유지**: HMR 시 게임 상태가 초기화될 수 있으므로, `core` 상태를 localStorage에 저장하거나 디버그용 "특정 보드 상태로 시작" 기능을 둔다. 고수치 타일 머지 연출을 반복 확인할 때 유용하다.

### 주의사항

- **코드 서명**: macOS는 Apple Developer 계정(연 $99)과 공증이 없으면 "손상된 앱" 경고가 뜬다. Windows도 서명이 없으면 SmartScreen 경고가 나온다. 지인 테스트용이면 생략 가능, 정식 배포라면 필요하다.
- **빌드 환경**: macOS 앱은 Mac에서 빌드한다. Windows 빌드는 GitHub Actions의 windows 러너 사용을 권장한다.
- **용량**: Chromium 포함으로 설치 파일이 약 80~150MB.
- **오디오 자동재생**: `autoplayPolicy` 설정으로 사용자 입력 전에도 재생을 허용한다.
- **보안 기본값**: `contextIsolation: true`, `nodeIntegration: false` 유지. 파일 저장 등 네이티브 기능만 preload로 노출한다.
