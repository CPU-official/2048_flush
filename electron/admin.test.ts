import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PORT, DEFAULT_TIMER } from '../src/constants';
import { normalizeAddress } from '../src/net/admin';
import { NetClient, testConnection } from '../src/net/client';
import { createAdmin } from './admin';

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

let dir: string;
let admin: ReturnType<typeof createAdmin>;
const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '2048-admin-'));
  admin = createAdmin(dir);
});
afterEach(async () => {
  await admin.run('server.stop');
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('normalizeAddress', () => {
  it('포트가 없으면 기본 포트를 붙이고, 형식이 틀리면 null', () => {
    expect(normalizeAddress(' 192.168.0.10 ')).toBe(`192.168.0.10:${DEFAULT_PORT}`);
    expect(normalizeAddress('192.168.0.10:9000')).toBe('192.168.0.10:9000');
    expect(normalizeAddress('localhost:1')).toBe('localhost:1');
    for (const bad of ['', '  ', 'a b:80', 'host:', 'host:abc', 'a:1:2', 'host:0', 'host:99999', 123, null]) expect(normalizeAddress(bad)).toBeNull();
  });
});

describe('admin', () => {
  it('기본 상태는 클라이언트 모드', async () => {
    const { ok, state } = await admin.run('state');
    expect(ok).toBe(true);
    expect(state).toMatchObject({ mode: 'client', serverAddress: '', port: DEFAULT_PORT, vfx: true, running: false, connectTo: '' });
  });

  it('서버 시작/중지가 모드와 접속 대상을 바꾸고 저장한다', async () => {
    const port = await freePort();
    const started = await admin.run('server.start', port);
    expect(started.ok).toBe(true);
    expect(started.state).toMatchObject({ mode: 'server', port, running: true, connectTo: `localhost:${port}` });
    expect(started.state.lanAddress).toMatch(new RegExp(`^[\\d.]+:${port}$`));
    expect(saved()).toMatchObject({ mode: 'server', port });
    expect(await testConnection(`localhost:${port}`)).toBe(true);

    expect((await admin.run('server.start', port)).ok).toBe(false);

    const stopped = await admin.run('server.stop');
    expect(stopped.state).toMatchObject({ mode: 'client', running: false, connectTo: '' });
    expect(saved().mode).toBe('client');
    expect(await testConnection(`localhost:${port}`)).toBe(false);
    expect((await admin.run('server.stop')).ok).toBe(false);
  });

  it('포트가 잘못됐거나 이미 쓰이고 있으면 시작하지 않는다', async () => {
    for (const bad of [0, 70000, 1.5, '8080', NaN]) expect((await admin.run('server.start', bad)).ok).toBe(false);
    const port = await freePort();
    const other = createAdmin(fs.mkdtempSync(path.join(os.tmpdir(), '2048-admin-')));
    await other.run('server.start', port);
    const result = await admin.run('server.start', port);
    expect(result.ok).toBe(false);
    expect(result.state.running).toBe(false);
    expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(false);
    await other.run('server.stop');
  });

  it('제한 시간 저장: 검증, 접속 중인 클라이언트에 전달, 재시작 후 유지', async () => {
    const timer = { start: 4, maxReduction: 2.5, midMove: 30, steepness: 0.2 };
    expect((await admin.run('timer.set', timer)).message).toContain('실행 중일 때만'); // 서버가 없을 때
    const port = await freePort();
    expect((await admin.run('state')).state.timer).toBeNull();
    expect((await admin.run('server.start', port)).state.timer).toEqual(DEFAULT_TIMER);

    for (const bad of [{ ...timer, start: 0 }, { ...timer, start: -1 }, { ...timer, start: 2, maxReduction: 1.6 }, { ...timer, midMove: NaN }, { ...timer, steepness: '0.1' }, null]) {
      const r = await admin.run('timer.set', bad);
      expect(r.ok).toBe(false);
      expect(r.state.timer).toEqual(DEFAULT_TIMER);
    }
    expect(fs.existsSync(path.join(dir, 'server-settings.json'))).toBe(false);
    expect((await admin.run('timer.set', { ...timer, start: 0.7, maxReduction: 0.2 })).ok).toBe(true); // 정확히 MIN_LIMIT은 허용
    await admin.run('timer.set', timer);

    const client = new NetClient();
    client.connect(`localhost:${port}`);
    await vi.waitFor(() => expect(client.connected).toBe(true));
    expect((await admin.run('timer.set', { ...timer, extra: 1 })).ok).toBe(true);
    await vi.waitFor(() => expect(client.timer).toEqual(timer));
    client.disconnect();

    await admin.run('server.stop');
    expect((await admin.run('server.start', port)).state.timer).toEqual(timer);
  });

  it('랭킹 CSV는 비밀번호 없이 내보내고, 초기화는 백업 후 비운다', async () => {
    expect((await admin.run('ranking.export')).ok).toBe(false); // 서버가 없을 때
    expect((await admin.run('ranking.reset')).ok).toBe(false);
    const port = await freePort();
    await admin.run('server.start', port);
    const client = new NetClient();
    client.connect(`localhost:${port}`);
    await vi.waitFor(() => expect(client.connected).toBe(true));
    const nick = 'kim,"x"';
    expect(await client.submit({ id: 'a', nickname: nick, password: '0123', score: 100, maxTile: 64 })).toBeNull();
    expect(await client.submit({ id: 'b', nickname: 'lee', password: '4567', score: 300, maxTile: 128 })).toBeNull();

    const exported = await admin.run('ranking.export');
    const csv = fs.readFileSync(exported.message.split(': ')[1], 'utf8');
    const lines = csv.trim().split('\n');
    expect(csv.charCodeAt(0)).toBe(0xfeff); // 엑셀에서 한글이 깨지지 않게 붙이는 BOM
    expect(lines[0]).toBe('닉네임,점수,최대 타일,기록 시각'); // trim()이 BOM을 지운다
    expect(lines[1]).toMatch(/^lee,300,128,\d{4}-/);
    expect(lines[2]).toMatch(/^"kim,""x""",100,64,/);
    expect(csv).not.toMatch(/0123|4567/);

    const reset = await admin.run('ranking.reset');
    expect(reset.ok).toBe(true);
    const backup = JSON.parse(fs.readFileSync(reset.message.split('백업: ')[1], 'utf8'));
    expect(backup.games).toHaveLength(2);
    expect(Object.keys(backup.users)).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'ranking.json'), 'utf8'))).toEqual({ users: {}, games: [] });
    const again = await admin.run('ranking.reset'); // 같은 초에 한 번 더: 앞선 백업이 빈 데이터로 덮이지 않아야 한다
    expect(again.message).not.toBe(reset.message);
    expect(JSON.parse(fs.readFileSync(reset.message.split('백업: ')[1], 'utf8')).games).toHaveLength(2);
    expect(await client.submit({ id: 'c', nickname: nick, password: '9999', score: 5, maxTile: 2 })).toBeNull(); // 닉네임도 비워졌다
    client.disconnect();
  });

  it('사용자 관리: 목록(비밀번호 없음), 비밀번호 재설정, 삭제', async () => {
    expect((await admin.run('user.delete', 'kim')).ok).toBe(false); // 서버가 없을 때
    expect((await admin.run('user.password', 'kim', '1234')).ok).toBe(false);
    const port = await freePort();
    expect((await admin.run('server.start', port)).state.users).toEqual([]);
    const client = new NetClient();
    client.connect(`localhost:${port}`);
    await vi.waitFor(() => expect(client.connected).toBe(true));
    const game = (id: string, nickname: string, password: string, score: number) => ({ id, nickname, password, score, maxTile: 64 });
    expect(await client.submit(game('a', 'lee', '1111', 10))).toBeNull();
    expect(await client.submit(game('b', 'kim', '0123', 20))).toBeNull();
    expect(await client.submit(game('c', 'kim', '0123', 30))).toBeNull();

    const listed = await admin.run('state');
    expect(listed.state.users).toEqual(['kim', 'lee']);
    expect(JSON.stringify(listed)).not.toMatch(/0123|1111/); // 비밀번호는 렌더러로 가지 않는다

    for (const bad of ['123', '12345', 'abcd', 1234, null]) expect((await admin.run('user.password', 'kim', bad)).ok).toBe(false);
    expect((await admin.run('user.password', 'nobody', '1234')).ok).toBe(false);
    const changed = await admin.run('user.password', 'kim', '9999');
    expect(changed.ok).toBe(true);
    expect(JSON.stringify(changed)).not.toContain('9999');
    expect(await client.submit(game('d', 'kim', '0123', 40))).toBe('password'); // 옛 비밀번호는 거부
    expect(await client.submit(game('e', 'kim', '9999', 40))).toBeNull();

    expect((await admin.run('user.delete', 'nobody')).ok).toBe(false);
    expect((await admin.run('user.delete', 'toString')).ok).toBe(false); // 프로토타입 키
    const deleted = await admin.run('user.delete', 'kim');
    expect(deleted.state.users).toEqual(['lee']);
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'ranking.json'), 'utf8'));
    expect(Object.keys(file.users)).toEqual(['lee']);
    expect(file.games.map((g: { nickname: string }) => g.nickname)).toEqual(['lee']);
    expect(await client.submit(game('f', 'kim', '5555', 1))).toBeNull(); // 지운 닉네임은 새로 등록할 수 있다
    client.disconnect();
  });

  it('server.status: 서버가 없으면 거부, 있으면 주소와 접속자 수', async () => {
    expect((await admin.run('server.status')).ok).toBe(false);
    const port = await freePort();
    await admin.run('server.start', port);
    expect((await admin.run('server.status')).message).toContain('접속자 0명');
    const client = new NetClient();
    client.connect(`localhost:${port}`);
    await vi.waitFor(() => expect(client.connected).toBe(true));
    const status = await admin.run('server.status');
    expect(status.message).toContain('접속자 1명');
    expect(status.message).toContain(`:${port}`);
    expect(status.message).toContain('대기 중 0명 · 진행 중인 대결 없음');
    client.disconnect();
  });

  it('서버 시작을 동시에 불러도 하나만 뜬다', async () => {
    const [a, b] = await Promise.all([admin.run('server.start', await freePort()), admin.run('server.start', await freePort())]);
    expect([a.ok, b.ok]).toEqual([true, false]);
    await admin.run('server.stop');
    expect(await testConnection(`localhost:${a.state.port}`)).toBe(false);
  });

  it('서버 모드로 저장돼 있으면 앱 시작 시 서버를 다시 띄운다', async () => {
    const port = await freePort();
    await admin.run('server.start', port);
    await admin.run('server.stop');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ mode: 'server', port }));
    admin = createAdmin(dir);
    expect((await admin.run('state')).state.running).toBe(false);
    await admin.init();
    expect((await admin.run('state')).state).toMatchObject({ running: true, port });
  });

  it('서버 주소 지정/해제와 VFX 설정을 저장한다', async () => {
    expect((await admin.run('connect', '10.0.0.5')).state.connectTo).toBe(`10.0.0.5:${DEFAULT_PORT}`);
    expect((await admin.run('connect', 'nope nope')).ok).toBe(false);
    expect((await admin.run('vfx', false)).state.vfx).toBe(false);
    expect(saved()).toMatchObject({ serverAddress: `10.0.0.5:${DEFAULT_PORT}`, vfx: false });
    await expect(createAdmin(dir).run('state')).resolves.toMatchObject({ state: { serverAddress: `10.0.0.5:${DEFAULT_PORT}`, vfx: false } });
    expect((await admin.run('disconnect')).state.connectTo).toBe('');
  });

  it('서버 실행 중에는 저장된 서버 주소와 무관하게 자기 서버에 접속한다', async () => {
    const port = await freePort();
    await admin.run('connect', '10.0.0.5:9000');
    const { state } = await admin.run('server.start', port);
    expect(state).toMatchObject({ serverAddress: '10.0.0.5:9000', connectTo: `localhost:${port}` });
    expect((await admin.run('server.stop')).state.connectTo).toBe('10.0.0.5:9000');
  });

  it('깨진 config.json은 기본값으로, 없는 명령은 실패로 처리한다', async () => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{bad');
    expect((await createAdmin(dir).run('state')).state.mode).toBe('client');
    for (const name of ['nope', 'constructor', 'toString']) expect((await admin.run(name)).ok).toBe(false);
  });
});
