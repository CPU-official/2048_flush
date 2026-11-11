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
