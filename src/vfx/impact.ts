import { FLASH_FROM, FLASH_MAX, FLASH_STEP, RECORD_FLASH, RECORD_FROM, SHAKE_FROM, SHAKE_MAX, SHAKE_STEP } from '../constants';
import type { GameEvent } from '../core/game';

// 한 수의 머지 값에서 연출 세기를 정한다. 값이 클수록 강하다 (docs/overview-project.md "연출").
export interface Impact {
  merge: number; // 이번 수에서 만들어진 가장 큰 머지 값 (없으면 0)
  shake: number; // px, 0이면 흔들지 않는다
  flash: number; // 0~1, 0이면 번쩍이지 않는다
  record: boolean; // 이번 게임의 최고 타일을 넘어섰다
}

// record: 이번 게임에서 지금까지 나온 가장 큰 타일
export function impactOf(events: GameEvent[], record: number): Impact {
  const merge = Math.max(0, ...events.map((e) => (e.type === 'merge' ? e.value : 0)));
  const level = Math.log2(Math.max(merge, 1));
  const isRecord = merge >= RECORD_FROM && merge > record;
  return {
    merge,
    shake: merge >= SHAKE_FROM ? Math.min(SHAKE_MAX, SHAKE_STEP * (level - 6)) : 0,
    flash: Math.max(merge >= FLASH_FROM ? Math.min(FLASH_MAX, FLASH_STEP * (level - 8)) : 0, isRecord ? RECORD_FLASH : 0),
    record: isRecord,
  };
}
