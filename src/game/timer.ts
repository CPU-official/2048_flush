import { MIN_LIMIT } from '../constants';

export interface TimerSettings {
  start: number;
  maxReduction: number;
  midMove: number;
  steepness: number;
}

// n = 지금까지 한 유효한 수의 횟수. 반환값은 초.
export function timeLimit(n: number, s: TimerSettings): number {
  return s.start - s.maxReduction / (1 + Math.exp(-s.steepness * (n - s.midMove)));
}

// 서버 설정 저장 전 검증. 문제가 없으면 null, 있으면 화면에 보여 줄 이유.
export function validateTimer(t: unknown): string | null {
  const s = t as Partial<Record<keyof TimerSettings, unknown>> | null;
  const keys = ['start', 'maxReduction', 'midMove', 'steepness'] as const;
  if (!s || keys.some((k) => typeof s[k] !== 'number' || !Number.isFinite(s[k] as number))) return '네 값 모두 숫자여야 합니다.';
  const { start, maxReduction } = s as TimerSettings;
  if (start <= 0) return '시작값은 0보다 커야 합니다.';
  if (start - maxReduction < MIN_LIMIT - 1e-9) return `시작값 - 최대감소값(최솟값)은 ${MIN_LIMIT}초 이상이어야 합니다.`;
  return null;
}
