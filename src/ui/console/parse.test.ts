import { describe, expect, it } from 'vitest';
import { parseCommand } from './parse';

describe('parseCommand', () => {
  it('표의 명령을 관리 함수 호출로 바꾼다', () => {
    expect(parseCommand('/server start')).toEqual({ call: ['server.start'] });
    expect(parseCommand('/server start 9000')).toEqual({ call: ['server.start', 9000] });
    expect(parseCommand('/server stop')).toEqual({ call: ['server.stop'] });
    expect(parseCommand('/server status')).toEqual({ call: ['server.status'] });
    expect(parseCommand('/connect 192.168.0.10:8080')).toEqual({ call: ['connect', '192.168.0.10:8080'] });
    expect(parseCommand('/disconnect')).toEqual({ call: ['disconnect'] });
    expect(parseCommand('/ranking export')).toEqual({ call: ['ranking.export'] });
    expect(parseCommand('/ranking reset confirm')).toEqual({ call: ['ranking.reset'] });
  });

  it('/ranking reset은 안내만 하고 실행하지 않는다', () => {
    const parsed = parseCommand('/ranking reset');
    expect(parsed).toHaveProperty('say');
    expect(JSON.stringify(parsed)).toContain('/ranking reset confirm');
  });

  it('공백과 대소문자를 너그럽게 받는다', () => {
    expect(parseCommand('  /SERVER   Stop ')).toEqual({ call: ['server.stop'] });
    expect(parseCommand('/ranking RESET Confirm')).toEqual({ call: ['ranking.reset'] });
    expect(parseCommand('/server start  9000')).toEqual({ call: ['server.start', 9000] });
  });

  it('포트가 숫자가 아니면 NaN으로 넘겨 관리 함수가 거부하게 한다', () => {
    expect(parseCommand('/server start abc')).toEqual({ call: ['server.start', NaN] });
  });

  it('빈 입력은 아무것도 하지 않고, 모르는 명령과 틀린 인자는 안내한다', () => {
    expect(parseCommand('   ')).toEqual({ say: '' });
    for (const bad of ['server start', '/foo', '/server', '/server restart', '/server stop now', '/disconnect x', '/ranking', '/ranking reset yes', '/ranking reset confirm x', '/server start 1 2']) {
      expect(parseCommand(bad), bad).toHaveProperty('say');
      expect(parseCommand(bad), bad).not.toHaveProperty('call');
    }
    expect(parseCommand('/connect')).toEqual({ say: '사용법: /connect <ip[:포트]>' });
    expect(parseCommand('/connect a b')).toEqual({ say: '사용법: /connect <ip[:포트]>' });
  });
});
