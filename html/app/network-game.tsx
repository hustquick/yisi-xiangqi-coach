"use client";
import { useRef, useState, useEffect } from 'react';

type Side = 'red' | 'black';
type MovePacket = { type: 'move'; gameId: string; ply: number; before: string; from: [number, number]; to: [number, number] };
type Game = { gameId: string; red: string; black: string; initiator: boolean };
export function useNetworkGame(options: {
  position: string; ply: number; turn: Side;
  start: () => void;
  receive: (from: [number, number], to: [number, number]) => boolean;
}) {
  const latest = useRef(options); latest.current = options;
  const [url, setUrl] = useState('http://localhost:8790');
  const [name, setName] = useState(''), [password, setPassword] = useState('');
  const [users, setUsers] = useState<Array<{ name: string; busy: boolean }>>([]);
  const [status, setStatus] = useState('未登录'), [logged, setLogged] = useState(false);
  const [active, setActive] = useState(false), [connected, setConnected] = useState(false);
  const [side, setSide] = useState<Side>('red');
  const [invitation, setInvitation] = useState<{ id: string; from: string } | null>(null);
  const session = useRef({ token: '', name: '', url: '', iceServers: [] as RTCIceServer[] });
  const game = useRef<Game | null>(null), pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null), events = useRef<AbortController | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]), serial = useRef(Promise.resolve());
  const pendingMove = useRef<number | null>(null), ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearConnection() {
    if (ackTimer.current) clearTimeout(ackTimer.current);
    pendingMove.current = null; dc.current?.close(); pc.current?.close();
    dc.current = null; pc.current = null; pending.current = []; setConnected(false);
  }
  async function api(path: string, data: unknown) {
    const s = session.current;
    const response = await fetch(s.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` }, body: JSON.stringify(data) });
    const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error ?? '连接失败'), { status: response.status }); return value;
  }
  function signal(kind: string, payload?: unknown) { return api('/signal', { gameId: game.current?.gameId, kind, payload }); }
  function bindChannel(channel: RTCDataChannel) {
    dc.current = channel;
    channel.onopen = () => { setStatus('对战已连接 · 正在核对局面'); channel.send(JSON.stringify({ type: 'sync', gameId: game.current?.gameId, ply: latest.current.ply, position: latest.current.position })); };
    channel.onclose = () => { setConnected(false); setStatus('连接断开，棋局已锁定；可重连或退出'); };
    channel.onmessage = event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 8192) throw new Error('无效消息');
        const m = JSON.parse(event.data), g = game.current, state = latest.current;
        if (!g || m.gameId !== g.gameId) throw new Error('对局身份不匹配');
        if (m.type === 'sync') {
          if (m.ply !== state.ply || m.position !== state.position) throw new Error('双方局面不一致，请退出后重新邀请');
          setConnected(true); setStatus('对战已连接 · 双方局面一致');
        } else if (m.type === 'ack') {
          if (m.ply !== pendingMove.current) throw new Error('落子确认不匹配');
          pendingMove.current = null; if (ackTimer.current) clearTimeout(ackTimer.current);
        } else if (m.type === 'move') {
          const localSide = session.current.name === g.red ? 'red' : 'black';
          if (pendingMove.current !== null || state.turn === localSide || m.ply !== state.ply || m.before !== state.position)
            throw new Error('回合或局面不一致');
          const validPoint = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] < 9 && p[1] >= 0 && p[1] < 10;
          if (!validPoint(m.from) || !validPoint(m.to) || !state.receive(m.from, m.to)) throw new Error('对手发送了不合法的走棋');
          channel.send(JSON.stringify({ type: 'ack', gameId: g.gameId, ply: m.ply + 1 }));
        } else throw new Error('未知对战消息');
      } catch (error) { clearConnection(); setStatus((error as Error).message + '，对局已锁定'); }
    };
  }
  async function connect(initiator: boolean) {
    clearConnection();
    if (!window.isSecureContext) throw new Error('联网对战需要 HTTPS 或本机 localhost');
    session.current.iceServers = (await api('/ice', {})).iceServers;
    const peer = new RTCPeerConnection({ iceServers: session.current.iceServers }); pc.current = peer;
    peer.onicecandidate = event => { if (event.candidate) void signal('candidate', event.candidate.toJSON()).catch(error => setStatus(error.message)); };
    peer.ondatachannel = event => bindChannel(event.channel);
    peer.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(peer.connectionState)) { setConnected(false); setStatus('网络中断，请点重连；棋局不会自动重开'); }
    };
    if (initiator) {
      bindChannel(peer.createDataChannel('yisi-xiangqi', { ordered: true }));
      await peer.setLocalDescription(await peer.createOffer());
      await signal('offer', peer.localDescription?.toJSON());
    }
  }
  async function handle(m: any) {
    if (m.type === 'presence') setUsers(m.users);
    else if (m.type === 'invite') setInvitation(m);
    else if (m.type === 'declined') setStatus('对手拒绝了邀请');
    else if (m.type === 'game') {
      game.current = m; setSide(session.current.name === m.red ? 'red' : 'black');
      latest.current.start(); setActive(true); setInvitation(null); setStatus('正在建立点对点连接…');
      await connect(m.initiator);
    } else if (m.type === 'signal' && m.gameId === game.current?.gameId) {
      if (m.kind === 'restart') { await connect(false); return; }
      const peer = pc.current; if (!peer) throw new Error('连接尚未初始化');
      if (m.kind === 'candidate') {
        if (peer.remoteDescription) await peer.addIceCandidate(m.payload); else pending.current.push(m.payload);
      } else if (m.kind === 'offer' || m.kind === 'answer') {
        if (m.payload?.type !== m.kind) throw new Error('连接描述错误');
        await peer.setRemoteDescription(m.payload);
        for (const candidate of pending.current.splice(0)) await peer.addIceCandidate(candidate);
        if (m.kind === 'offer') { await peer.setLocalDescription(await peer.createAnswer()); await signal('answer', peer.localDescription?.toJSON()); }
      }
    } else if (['peer-left', 'expired'].includes(m.type) && m.gameId === game.current?.gameId) {
      clearConnection(); game.current = null; setActive(false); setStatus('对局已结束，棋谱留在本机');
    } else if (m.type === 'peer-offline') setStatus('对手信令离线；已建立的直连可能仍可继续');
    else if (m.type === 'signed-out') { events.current?.abort(); clearConnection(); game.current = null; setActive(false); setLogged(false); setStatus('账号已在其他设备登录'); }
  }
  async function subscribe() {
    events.current?.abort(); const controller = new AbortController(); events.current = controller;
    const response = await fetch(session.current.url + '/events', { headers: { Authorization: `Bearer ${session.current.token}` }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('在线连接失败，请重新登录');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (frame.startsWith('data: ')) {
          const message = JSON.parse(frame.slice(6));
          serial.current = serial.current.then(() => handle(message)).catch(error => { setStatus(error.message); });
        }
      }
      if (buffer.length > 65536) throw new Error('信令消息过大');
    }
    if (!controller.signal.aborted) setStatus('在线服务已断开，请点恢复在线');
  }
  async function login(register: boolean) {
    try {
      if (active) throw new Error('请先退出当前对局');
      const endpoint = new URL(url); if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.pathname !== '/') throw new Error('请填写服务根地址');
      if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('公网账号登录必须使用 HTTPS');
      session.current.url = endpoint.origin;
      const result = await api(register ? '/register' : '/login', { name, password });
      session.current = { ...session.current, ...result }; setPassword(''); setLogged(true); setStatus('已登录 · 等待邀请');
      void subscribe().catch(error => { if (error.name !== 'AbortError') setStatus(error.message); });
    } catch (error) { setStatus((error as Error).message); }
  }
  async function leave() {
    try { if (game.current) await api('/leave', { gameId: game.current.gameId }); }
    catch (error) {
      if (![401, 403].includes((error as Error & { status?: number }).status ?? 0)) {
        setStatus((error as Error).message + '；服务器可能暂时保留对局，恢复在线后重试退出'); return;
      }
      events.current?.abort(); setLogged(false);
    }
    clearConnection(); game.current = null; setActive(false); setStatus('已退出对局');
  }
  useEffect(() => () => { events.current?.abort(); dc.current?.close(); pc.current?.close(); if (ackTimer.current) clearTimeout(ackTimer.current); }, []);
  function sendMove(from: [number, number], to: [number, number]) {
    const state = latest.current;
    if (!connected || !game.current || !dc.current || dc.current.readyState !== 'open' || state.turn !== side || pendingMove.current !== null) return false;
    const packet: MovePacket = { type: 'move', gameId: game.current.gameId, ply: state.ply, before: state.position, from, to };
    try { dc.current.send(JSON.stringify(packet)); pendingMove.current = state.ply + 1;
      ackTimer.current = setTimeout(() => { clearConnection(); setStatus('未收到落子确认，已锁定对局，请重连核对局面'); }, 10_000);
      return true;
    } catch { setConnected(false); setStatus('发送失败，落子未执行'); return false; }
  }
  const panel = <details className="collapsible-module network-panel" open><summary>网络对战 · 注册 / 邀请好友</summary><div className="collapsible-content" style={{ display: 'grid', gap: 8 }}>
    <style>{`.network-panel label{display:grid;gap:6px;font-size:13px;color:#365a47}.network-panel input{box-sizing:border-box;width:100%;min-height:40px;padding:8px 10px;border:1px solid #d9d3c4;border-radius:8px;background:#fff;font:inherit}.network-panel button{min-height:38px;padding:7px 12px;margin:3px 3px 3px 0;border:1px solid #c9d4c9;border-radius:8px;background:#edf3ed;color:#245f43;font:inherit;cursor:pointer}.network-panel button:disabled{opacity:.45;cursor:default}.network-panel p{font-size:14px;overflow-wrap:anywhere}.network-panel small{color:#77746b;line-height:1.6}`}</style>
    <label>连接服务 <input aria-label="连接服务" value={url} disabled={logged} onChange={e => setUrl(e.target.value)} placeholder="https://你的域名" /></label>
    {!logged && <><label>账号 <input aria-label="网络账号" autoComplete="username" value={name} onChange={e => setName(e.target.value)} /></label><label>密码 <input aria-label="网络密码" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><div><button onClick={() => void login(true)}>注册并上线</button> <button onClick={() => void login(false)}>登录</button></div></>}
    <p role="status">{status}{active ? ` · 你执${side === 'red' ? '红' : '黑'}` : ''}</p>
    {logged && !active && <><small>邀请方执红，接受方执黑；新对局从标准初始局面开始。</small>{users.filter(u => u.name !== session.current.name).map(u => <button key={u.name} disabled={u.busy} onClick={() => void api('/invite', { to: u.name }).then(() => setStatus('邀请已发出，等待对手接受')).catch(e => setStatus(e.message))}>邀请 {u.name}{u.busy ? '（对局中）' : ''}</button>)}</>}
    {invitation && !active && <div>{invitation.from} 邀请你对战 <button onClick={() => void api('/respond', { id: invitation.id, accept: true }).catch(e => setStatus(e.message))}>接受</button> <button onClick={() => void api('/respond', { id: invitation.id, accept: false }).then(() => setInvitation(null)).catch(e => setStatus(e.message))}>拒绝</button></div>}
    {active && <div><button disabled={connected} onClick={() => void signal('restart').then(() => connect(true)).catch(e => setStatus(e.message))}>重连并核对局面</button> <button onClick={() => void leave()}>退出对局</button></div>}
    {logged && <div><button onClick={() => void subscribe().catch(e => setStatus(e.message))}>恢复在线</button> <button disabled={active} onClick={() => void api('/logout', {}).then(() => { events.current?.abort(); setLogged(false); setUsers([]); session.current.token = ''; setStatus('已退出登录'); }).catch(e => setStatus(e.message))}>退出登录</button></div>}
    <small>走棋经加密通道传输，优先直连，无法直连时使用服务配置的中继。联网对战期间禁用单方悔棋、摆盘和载入；该版本不提供防引擎作弊排名。</small>
  </div></details>;
  return { active, side, connected, sendMove, panel };
}
