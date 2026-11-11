// 조정 가능한 값. 서버와 클라이언트가 같이 읽는다 (docs/overview-project.md "조정 가능한 값").
export const DEFAULT_TIMER = { start: 3.0, maxReduction: 2.0, midMove: 40, steepness: 0.1 };
export const MIN_LIMIT = 0.5; // 초. 제한 시간 곡선의 최솟값(start - maxReduction) 하한
export const DEMO_STEP = 0.35; // 초. 시작 화면 데모가 한 수 두는 간격
export const DEMO_END_PAUSE = 2.5; // 초. 데모 로그가 끝난 뒤 다시 시작하기까지
// 머지 연출 세기 (값이 클수록 강하다). docs/overview-project.md "연출"
export const SHAKE_FROM = 128; // 이 머지 값부터 화면이 흔들린다
export const SHAKE_STEP = 4; // px. 값이 두 배가 될 때마다 늘어나는 세기
export const SHAKE_MAX = 24; // px
export const FLASH_FROM = 512; // 이 머지 값부터 화면이 번쩍인다
export const FLASH_STEP = 0.1; // 투명도. 값이 두 배가 될 때마다 늘어난다
export const FLASH_MAX = 0.4;
export const RECORD_FROM = 64; // 이 값부터 이번 게임 최고 타일 갱신 연출 (작은 값은 매 판 계속 갱신돼 소란스럽다)
export const RECORD_FLASH = 0.15; // 갱신 시 최소 번쩍임
export const RECORD_BURST = 3; // 갱신한 머지의 파티클 배수 (전체 상한은 Particles가 지킨다)
export const GRACE = 0.15; // 초
export const IDLE_LOGOUT = 60; // 초
export const NICKNAME_MAX = 10;
export const DEFAULT_PORT = 8080;
export const RECONNECT_INTERVAL = 3; // 초. 서버 접속이 끊겼을 때 재시도 간격
export const REQUEST_TIMEOUT = 5; // 초. 서버 응답 대기
export const RANK_TOP = 50; // 랭킹 화면에 보여 줄 줄 수
export const BACKUP_INTERVAL = 300; // 초. 랭킹 주기적 백업 간격
