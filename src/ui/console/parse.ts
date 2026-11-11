// 슬래시 커맨드 문자열을 관리 함수 호출로 바꾼다 (docs/networking.md "슬래시 커맨드"). 순수 함수라 화면 없이 테스트한다.
export type Parsed = { call: [name: string, ...args: unknown[]] } | { say: string };

export const HELP =
  '명령: /server start [포트] · /server stop · /server status · /connect <ip[:포트]> · /disconnect · /ranking export · /ranking reset';

export function parseCommand(input: string): Parsed {
  const words = input.trim().split(/\s+/);
  if (words[0] === '') return { say: '' };
  const [cmd, sub] = words.map((w) => w.toLowerCase());
  const args = words.slice(cmd === '/server' || cmd === '/ranking' ? 2 : 1);
  const unknown = { say: `알 수 없는 명령입니다. ${HELP}` };

  if (cmd === '/server') {
    if (sub === 'start' && args.length <= 1) return { call: args.length ? ['server.start', Number(args[0])] : ['server.start'] };
    if (sub === 'stop' && !args.length) return { call: ['server.stop'] };
    if (sub === 'status' && !args.length) return { call: ['server.status'] };
    return unknown;
  }
  if (cmd === '/connect') return args.length === 1 ? { call: ['connect', args[0]] } : { say: '사용법: /connect <ip[:포트]>' };
  if (cmd === '/disconnect') return args.length ? unknown : { call: ['disconnect'] };
  if (cmd === '/ranking') {
    if (sub === 'export' && !args.length) return { call: ['ranking.export'] };
    if (sub === 'reset' && !args.length) {
      return { say: '랭킹을 초기화하려면 /ranking reset confirm 을 입력하세요. 기록과 닉네임이 모두 지워지고, 지우기 전에 자동 백업됩니다.' };
    }
    if (sub === 'reset' && args.length === 1 && args[0].toLowerCase() === 'confirm') return { call: ['ranking.reset'] };
    return unknown;
  }
  return unknown;
}
