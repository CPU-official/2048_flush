// 조정 가능한 값. 서버와 클라이언트가 같이 읽는다 (docs/overview-project.md "조정 가능한 값").
export const DEFAULT_TIMER = { start: 3.0, maxReduction: 2.0, midMove: 40, steepness: 0.1 };
export const GRACE = 0.15; // 초
export const IDLE_LOGOUT = 60; // 초
export const NICKNAME_MAX = 10;
export const DEFAULT_PORT = 8080;
export const RECONNECT_INTERVAL = 3; // 초. 서버 접속이 끊겼을 때 재시도 간격
export const REQUEST_TIMEOUT = 5; // 초. 서버 응답 대기
export const RANK_TOP = 50; // 랭킹 화면에 보여 줄 줄 수
export const BACKUP_INTERVAL = 300; // 초. 랭킹 주기적 백업 간격
