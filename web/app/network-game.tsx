"use client";
import { useRef, useState, useEffect } from 'react';

type Side = 'red' | 'black';
type MovePacket = { type: 'move'; gameId: string; ply: number; before: string; from: [number, number]; to: [number, number] };
type Game = { gameId: string; red: string; black: string; initiator: boolean };
export function useNetworkGame(options: {
  position: string; ply: number; turn: Side;
  selected?: [number,number] | null;
  start: () => void;
  record?: () => unknown;
  review?: (saved:any) => void;
  watch?: (saved:any) => void;
  focusBoard?: () => void;
  receive: (from: [number, number], to: [number, number]) => boolean;
}) {
  const latest = useRef(options); latest.current = options;
  const [name, setName] = useState(''), [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [confirmPassword, setConfirmPassword] = useState(''), [authBusy, setAuthBusy] = useState(false);
  type Friend = { name: string; id: string; nickname: string; online: boolean; busy: boolean; added?: boolean; rating?:number; provisional?:boolean };
  const [rating,setRating]=useState<{rating:number;games:number}|null>(null);
  const [nickname,setNickname] = useState('');
  const [history,setHistory] = useState<any[] | null>(null);
  const [matchStats,setMatchStats] = useState<{opponent:{id:string;nickname:string};total:number;wins:number;losses:number;draws:number}|null>(null);
  const [users, setUsers] = useState<Friend[]>([]);
  const [requests,setRequests] = useState<Friend[]>([]);
  const [friendQuery, setFriendQuery] = useState(''), [foundFriend, setFoundFriend] = useState<Friend | null>(null);
  const [searchResults,setSearchResults] = useState<Friend[]>([]);
  const [friendMessage, setFriendMessage] = useState(''), [friendBusy, setFriendBusy] = useState(false);
  const [presence, setPresence] = useState<'online' | 'invisible'>('online');
  const [showFriends, setShowFriends] = useState(false);
  const [inviteSide,setInviteSide] = useState<Side>('red');
  const [swapSides,setSwapSides] = useState(true);
  const [minutes,setMinutes]=useState(15);
  const [matching,setMatching]=useState(false);
  const [active, setActive] = useState(false), [connected, setConnected] = useState(false);
  const [clock,setClock]=useState<{limit:number;used:Record<Side,number>;turn:Side;ended:boolean;stepLimit?:number;stepRemaining?:number;ply?:number}|null>(null);
  useEffect(()=>{
    if(!active) {setClock(null);return;}
    const update=()=>{if(game.current) void api('/clock',{gameId:game.current.gameId}).then(setClock).catch(()=>{});};
    update();const timer=setInterval(update,1000);return()=>clearInterval(timer);
  },[active]);
  useEffect(()=>{
    if(active && options.ply>0 && options.turn!==side && game.current)
      void api('/clock/move',{gameId:game.current.gameId,ply:options.ply,content:latest.current.record?.()}).then(setClock).catch(e=>setStatus(e.message));
  },[options.ply]);
  const [friendDetails, setFriendDetails] = useState<string | null>(null), [presenceBusy, setPresenceBusy] = useState(false);
  const [status, setStatus] = useState('未登录'), [logged, setLogged] = useState(false);
  const [watching,setWatching] = useState<string|null>(null);
  const watchingRef=useRef(watching);watchingRef.current=watching;
  const watchedContent=useRef('');
  const watchRevision=useRef(0);
  function receiveWatch(result:any) {
    watchRevision.current++;
    const encoded=JSON.stringify(result.content);
    if(result.content && encoded!==watchedContent.current) {
      const entering=!watchedContent.current;
      latest.current.watch?.(result.content);watchedContent.current=encoded;
      if(entering) latest.current.focusBoard?.();
    }
    setPeerSelected(result.selected??null);
  }
  const [drawOffer,setDrawOffer] = useState(false), [roundEnding,setRoundEnding] = useState(false);
  useEffect(()=>{
    if(!logged){setRating(null);return;}
    let stopped=false;
    void api('/ice',{}).then(value=>{if(!stopped)setRating(value);}).catch(()=>{});
    return()=>{stopped=true;};
  },[logged,roundEnding]);
  const [undoOffer,setUndoOffer]=useState(false);
  const [timeOffer,setTimeOffer]=useState(false);
  const [peerSelected,setPeerSelected]=useState<[number,number]|null>(null);
  const [peerOffline,setPeerOffline]=useState(false),[linkLost,setLinkLost]=useState(false);
  const [requestFocus,setRequestFocus]=useState('');
  const operationsRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!active) return;
    const frame=requestAnimationFrame(()=>{
      const card=operationsRef.current?.querySelector<HTMLElement>(`[data-request="${roundEnding?'rematch':requestFocus}"]`);
      card?.scrollIntoView({behavior:'smooth',block:'center'});
      card?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    });return()=>cancelAnimationFrame(frame);
  },[requestFocus,timeOffer,undoOffer,drawOffer,active,roundEnding]);
  useEffect(()=>{
    if(!active) return;
    const publish=()=>{if(game.current) void api('/watch/update',{gameId:game.current.gameId,content:latest.current.record?.()}).catch(()=>{});};
    const timer=setInterval(publish,2000);publish();return()=>clearInterval(timer);
  },[active]);
  useEffect(()=>{
    setPeerSelected(null);watchedContent.current='';
    if(!watching) return;
    let stopped=false, pending=false;
    const update=async()=>{
      if(pending) return;pending=true;
      const revision=watchRevision.current;
      try { const result=await api('/watch',{name:watching});if(stopped || revision!==watchRevision.current)return;
        receiveWatch(result);
      } catch(error) { if(!stopped){setWatching(null);setStatus((error as Error).message+'，已结束观战');} }
      finally{pending=false;}
    };
    const timer=setInterval(update,2000);void update();return()=>{stopped=true;clearInterval(timer);};
  },[watching]);
  const [side, setSide] = useState<Side>('red');
  const [invitation, setInvitation] = useState<{ id: string; from: string; side?:Side; swapSides?:boolean; minutes?:number; fromProfile?: {id:string;nickname:string} } | null>(null);
  const inviteDialog = useRef<HTMLElement | null>(null);
  const networkPanel = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (!invitation || active) return;
    const previous = document.activeElement as HTMLElement | null;
    if (networkPanel.current) networkPanel.current.open=true;
    const dialog = inviteDialog.current;
    dialog?.scrollIntoView({behavior:'smooth',block:'center'});
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button');
    buttons?.[0]?.focus({preventScroll:true});
    return () => { if(previous?.isConnected) previous.focus({preventScroll:true}); };
  },[invitation?.id,active]);
  const session = useRef({ token: '', name: '', id: '', nickname: '', url: '', iceServers: [] as RTCIceServer[] });
  function persistSession() {try{localStorage.setItem('yisi-network-session',JSON.stringify(session.current));}catch{}}
  function forgetSession() {try{const saved=JSON.parse(localStorage.getItem('yisi-network-session')??'null');if(saved?.token===session.current.token)localStorage.removeItem('yisi-network-session');}catch{}}
  useEffect(()=>{
    if(window.location.protocol==='file:')return;
    let stopped=false;
    try {
      const saved=JSON.parse(localStorage.getItem('yisi-network-session')??'null');
      const configured=document.querySelector<HTMLMetaElement>('meta[name="yisi-network-endpoint"]')?.content;
      const local=['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
      const expected=new URL(configured || (local?'http://localhost:8790':window.location.origin)).origin;
      if(saved?.token && saved.url===expected) {
        session.current={...session.current,...saved};setStatus('正在恢复登录与对局…');
        void api('/ice',{}).then(result=>{
          if(stopped)return;session.current={...session.current,...result};persistSession();
          setNickname(result.nickname??saved.nickname);setPresence(result.presence??'online');setLogged(true);
          void subscribe();
        }).catch(error=>{if(!stopped)setStatus(error.message);});
      }
    }catch{}
    return()=>{stopped=true;};
  },[]);
  const game = useRef<Game | null>(null), pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null), events = useRef<AbortController | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]), serial = useRef(Promise.resolve());
  const pendingMove = useRef<number | null>(null), ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(()=>{
    if(!active || !connected || !game.current || dc.current?.readyState!=='open') return;
    const point=options.turn===side && !roundEnding ? options.selected??null : null;
    try{dc.current.send(JSON.stringify({type:'selection',gameId:game.current.gameId,before:options.position,point}));}catch{}
    if(options.turn===side && !roundEnding) void api('/watch/selection',{gameId:game.current.gameId,ply:options.ply,point}).catch(()=>{});
  },[options.selected?.[0],options.selected?.[1],options.position,active,connected,roundEnding]);
  function clearConnection() {
    setPeerSelected(null);
    if (ackTimer.current) clearTimeout(ackTimer.current);
    pendingMove.current = null;
    if (dc.current) { dc.current.onclose = null; dc.current.onmessage = null; dc.current.onopen = null; dc.current.close(); }
    if (pc.current) { pc.current.onconnectionstatechange = null; pc.current.onicecandidate = null; pc.current.ondatachannel = null; pc.current.close(); }
    dc.current = null; pc.current = null; pending.current = []; setConnected(false);
  }
  function forcedSignOut(message:string) {
    setMatching(false);
    forgetSession();
    events.current?.abort();clearConnection();game.current=null;session.current.token='';
    setActive(false);setWatching(null);setLogged(false);setInvitation(null);
    setDrawOffer(false);setUndoOffer(false);setTimeOffer(false);setHistory(null);setMatchStats(null);
    setUsers([]);setRequests([]);setFoundFriend(null);setSearchResults([]);setFriendDetails(null);
    setPassword('');setConfirmPassword('');setStatus(message);
  }
  async function api(path: string, data: unknown) {
    const s = session.current;
    const requestToken=s.token;
    const response = await fetch(s.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` }, body: JSON.stringify(data) });
    const value = await response.json();
    if(requestToken && requestToken!==session.current.token) throw new Error('登录状态已变更');
    if(response.status===401 && !['/login','/register'].includes(path)) forcedSignOut('登录已失效，本端已退出；账号可能已在其他设备登录');
    if (!response.ok) throw Object.assign(new Error(value.error ?? '连接失败'), { status: response.status }); return value;
  }
  function signal(kind: string, payload?: unknown) { return api('/signal', { gameId: game.current?.gameId, kind, payload }); }
  function bindChannel(channel: RTCDataChannel) {
    dc.current = channel;
    channel.onopen = () => { setStatus('对战已连接 · 正在核对局面'); channel.send(JSON.stringify({ type: 'sync', gameId: game.current?.gameId, ply: latest.current.ply, position: latest.current.position })); };
    channel.onclose = () => { setConnected(false);setLinkLost(true);setPeerSelected(null); setStatus('与对方连接已断开，棋局已锁定；可重连或退出'); };
    channel.onmessage = event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 8192) throw new Error('无效消息');
        const m = JSON.parse(event.data), g = game.current, state = latest.current;
        if (!g || m.gameId !== g.gameId) throw new Error('对局身份不匹配');
        if (m.type === 'sync') {
          if (m.ply !== state.ply || m.position !== state.position) throw new Error('双方局面不一致，请退出后重新邀请');
          setConnected(true); setStatus('对战已连接 · 双方局面一致');
          setLinkLost(false);
        } else if(m.type==='selection') {
          if(m.point===null) {setPeerSelected(null);return;}
          const localSide=session.current.name===g.red?'red':'black';
          if(state.turn!==localSide && m.before===state.position && Array.isArray(m.point) && m.point.length===2 && Number.isInteger(m.point[0]) && Number.isInteger(m.point[1]) && m.point[0]>=0 && m.point[0]<9 && m.point[1]>=0 && m.point[1]<10) setPeerSelected(m.point);
        } else if (m.type === 'ack') {
          if (m.ply !== pendingMove.current) throw new Error('落子确认不匹配');
          pendingMove.current = null; if (ackTimer.current) clearTimeout(ackTimer.current);
        } else if (m.type === 'move') {
          const localSide = session.current.name === g.red ? 'red' : 'black';
          if (pendingMove.current !== null || state.turn === localSide || m.ply !== state.ply || m.before !== state.position)
            throw new Error('回合或局面不一致');
          const validPoint = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] < 9 && p[1] >= 0 && p[1] < 10;
          if (!validPoint(m.from) || !validPoint(m.to) || !state.receive(m.from, m.to)) throw new Error('对手发送了不合法的走棋');
          setPeerSelected(null);
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
      if (['failed', 'disconnected'].includes(peer.connectionState)) { setConnected(false);setLinkLost(true);setPeerSelected(null); setStatus('与对方连接已中断，请点重连；棋局不会自动重开'); }
      else if(peer.connectionState==='connected' && dc.current?.readyState==='open') dc.current.send(JSON.stringify({type:'sync',gameId:game.current?.gameId,ply:latest.current.ply,position:latest.current.position}));
    };
    if (initiator) {
      bindChannel(peer.createDataChannel('yisi-xiangqi', { ordered: true }));
      await peer.setLocalDescription(await peer.createOffer());
      await signal('offer', peer.localDescription?.toJSON());
    }
  }
  async function handle(m: any) {
    if(m.type==='match-state') {setMatching(m.waiting);if(m.waiting)setStatus(`正在匹配 ${m.minutes} 分钟对局…`);}
    else if(m.type==='watch-state') {if(watchingRef.current===m.name) receiveWatch(m);}
    else if (m.type === 'ready') {
      const resumed=m.games?.[0];
      if(!game.current && resumed) {
        game.current={gameId:resumed.id,red:resumed.red,black:resumed.black,initiator:session.current.name===resumed.red};
        setSide(session.current.name===resumed.red?'red':'black');setActive(true);setWatching(null);
        latest.current.start();if(resumed.content)latest.current.watch?.(resumed.content);
        await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
        await signal('restart',{});await connect(session.current.name===resumed.red);
        setStatus('已恢复原对局，正在重新连接对手…');
        if(resumed.result) {setRoundEnding(true);setStatus('本局已结束，双方同意后开始下一局');}
      } else if (game.current && !m.games?.some((g: { id: string }) => g.id === game.current?.gameId)) {
        clearConnection(); game.current = null; setActive(false); setStatus('对局已结束，棋谱留在本机');
      } else setStatus(game.current ? connected ? '对战已连接 · 双方局面一致' : '在线连接已恢复，可重连核对局面' : '已登录 · 等待邀请');
    }
    else if (m.type === 'invite-expired') { setInvitation(current => current?.id === m.id ? null : current); setStatus('邀请已失效'); }
    else if (m.type === 'presence') { setUsers(m.users); setRequests(m.requests??[]); }
    else if (m.type === 'invite') setInvitation(m);
    else if (m.type === 'declined') setStatus('对手拒绝了邀请');
    else if (m.type === 'game') {
      setMatching(false);
      setPeerOffline(false);setLinkLost(false);
      setWatching(null);
      setDrawOffer(false);setRoundEnding(false);
      setUndoOffer(false);
      setTimeOffer(false);
      game.current = m; setSide(session.current.name === m.red ? 'red' : 'black');
      latest.current.start(); setActive(true); setInvitation(null); setStatus('正在建立点对点连接…');
      await connect(m.initiator);
    } else if (m.type === 'signal' && m.gameId === game.current?.gameId) {
      if (m.kind === 'restart') { await connect(session.current.name===game.current?.red); return; }
      const peer = pc.current; if (!peer) throw new Error('连接尚未初始化');
      if (m.kind === 'candidate') {
        if (peer.remoteDescription) await peer.addIceCandidate(m.payload); else pending.current.push(m.payload);
      } else if (m.kind === 'offer' || m.kind === 'answer') {
        if (m.payload?.type !== m.kind) throw new Error('连接描述错误');
        await peer.setRemoteDescription(m.payload);
        for (const candidate of pending.current.splice(0)) await peer.addIceCandidate(candidate);
        if (m.kind === 'offer') { await peer.setLocalDescription(await peer.createAnswer()); await signal('answer', peer.localDescription?.toJSON()); }
      }
    } else if(m.type==='time-offer' && m.gameId===game.current?.gameId) {setTimeOffer(true);setRequestFocus('time');setStatus('对方申请双方各加时5分钟，请选择同意或拒绝');}
    else if(m.type==='time-result' && m.gameId===game.current?.gameId) {setTimeOffer(false);setStatus(m.accepted?'双方已同意，各加时5分钟':'加时申请已拒绝');}
    else if(m.type==='undo-offer' && m.gameId===game.current?.gameId) {setUndoOffer(true);setRequestFocus('undo');setStatus('对方申请悔棋，请选择同意或拒绝');}
    else if(m.type==='undo-applied' && m.gameId===game.current?.gameId) {setUndoOffer(false);setPeerSelected(null);pendingMove.current=null;if(ackTimer.current)clearTimeout(ackTimer.current);latest.current.watch?.(m.content);setStatus('双方已同意，已回退一步；用时不退还');}
    else if(m.type==='undo-declined' && m.gameId===game.current?.gameId) {setStatus('对方拒绝悔棋');}
    else if(m.type==='draw-offer' && m.gameId===game.current?.gameId) {setDrawOffer(true);setRequestFocus('draw');setStatus('对方提和，请选择同意或拒绝');}
    else if(m.type==='draw-declined' && m.gameId===game.current?.gameId) {setStatus('对方拒绝提和，继续对局');}
    else if(m.type==='round-finished' && m.gameId===game.current?.gameId) { setMatchStats(m.stats);setPeerSelected(null);setDrawOffer(false);setRoundEnding(true);setStatus(`${m.result==='draw'?'双方和棋':m.result==='red'?'红方获胜':'黑方获胜'}，是否再来一局？双方同意后开始`); }
    else if(m.type==='rematch-state' && m.gameId===game.current?.gameId) {setStatus(m.ready.includes(session.current.name)?'已同意下一局，等待对方确认':'对方希望再来一局，请确认或退出');}
    else if (['peer-left', 'expired'].includes(m.type) && m.gameId === game.current?.gameId) {
      if(m.stats) setMatchStats(m.stats);
      clearConnection(); game.current = null; setActive(false); setInvitation(null);
      setStatus(m.reason==='disconnect-timeout' ? '对方断线超过5分钟，当前对局已自动结束' : m.type === 'peer-left' ? '对方已退出，当前对局已结束；你已自动退出，可查看历史对局并复盘' : '对局已结束，你已自动退出');
      if(networkPanel.current) { networkPanel.current.open=true; networkPanel.current.scrollIntoView({behavior:'smooth',block:'center'}); }
    } else if (m.type === 'peer-offline' && m.gameId===game.current?.gameId) {setPeerOffline(true);setPeerSelected(null);setStatus('对方已断线，等待重连；5分钟内未恢复将结束对局');}
    else if(m.type==='peer-online' && m.gameId===game.current?.gameId) {setPeerOffline(false);setStatus('对方已重新上线');}
    else if (m.type === 'signed-out') forcedSignOut('账号已在其他设备登录，本端已退出');
  }
  async function subscribe() {
    events.current?.abort(); const controller = new AbortController(); events.current = controller;
    let retry = 0;
    while (!controller.signal.aborted) {
    try {
    const response = await fetch(session.current.url + '/events', { headers: { Authorization: `Bearer ${session.current.token}` }, signal: controller.signal });
    if (response.status === 401) { forcedSignOut('登录已失效，本端已退出；账号可能已在其他设备登录');controller.abort();return; }
    if (!response.ok || !response.body) throw new Error('在线连接失败，请重新登录');
    retry = 0;
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
    } catch (error) { if (controller.signal.aborted) return; }
    if (controller.signal.aborted) return;
    setStatus('网络暂时断开，正在恢复在线连接…');
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, Math.min(30_000, 1000 * 2 ** Math.min(retry++, 5)));
      controller.signal.addEventListener('abort', finish, { once: true });
    });
    }
  }
  async function login(register: boolean) {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      if (active) throw new Error('请先退出当前对局');
      if (register && password !== confirmPassword) throw new Error('两次输入的密码不一致，请重新确认');
      if (window.location.protocol === 'file:') throw new Error('请使用文件夹中的“启动联网版”入口，或运行 npm run local，再打开 http://localhost:8080；双击 index.html 仅支持本地功能。');
      // Deployment configuration belongs to the application, never to the player UI.
      const configured = document.querySelector<HTMLMetaElement>('meta[name="yisi-network-endpoint"]')?.content;
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
      const endpoint = new URL(configured || (local ? 'http://localhost:8790' : window.location.origin));
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.pathname !== '/' || endpoint.username || endpoint.password) throw new Error('网络对战配置异常，请联系管理员');
      if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('网络对战尚未开放安全连接，请稍后再试');
      session.current.url = endpoint.origin;
      const result = await api(register ? '/register' : '/login', { name, password });
      session.current = { ...session.current, ...result }; setNickname(result.nickname); setHistory(null); setPresence(register ? 'online' : result.presence ?? 'online'); setPassword(''); setConfirmPassword(''); setLogged(true); setStatus(register ? '注册成功，已登录并在线' : '已登录 · 等待邀请');
      persistSession();
      void subscribe().catch(error => { if (error.name !== 'AbortError') setStatus(error.message); });
    } catch (error) { setStatus((error as Error).message); }
    finally { setAuthBusy(false); }
  }
  async function leave() {
    try { if (game.current) { const result=await api('/leave', { gameId: game.current.gameId,content:latest.current.record?.() });setMatchStats(result.stats??null); } }
    catch (error) {
      if (![401, 403].includes((error as Error & { status?: number }).status ?? 0)) {
        setStatus((error as Error).message + '；服务器可能暂时保留对局，恢复在线后重试退出'); return;
      }
      events.current?.abort(); setLogged(false);
    }
    clearConnection(); game.current = null; setActive(false); setStatus('已退出对局');
  }
  async function searchFriend() {
    if (friendBusy) return;
    setFriendBusy(true); setFoundFriend(null);
    try { const result = await api('/search', { name: friendQuery }); setSearchResults(result.users??[]); setFoundFriend(result.user); setFriendMessage(result.user ? '' : '没有找到匹配用户'); }
    catch (error) { setFriendMessage((error as Error).message); }
    finally { setFriendBusy(false); }
  }
  async function changePresence(mode: 'online' | 'invisible') {
    if (presenceBusy) return;
    setPresenceBusy(true);
    try { const result = await api('/presence', { mode }); setPresence(result.presence); }
    catch (error) { setStatus((error as Error).message); }
    finally { setPresenceBusy(false); }
  }
  async function logout() {
    if (active || presenceBusy) return;
    setPresenceBusy(true);
    try {
      await api('/logout', {});
      forgetSession();session.current.token='';
      events.current?.abort(); setLogged(false); setUsers([]); setFoundFriend(null); setFriendMessage('');
      session.current.token = ''; setStatus('已退出登录');
    } catch (error) { setStatus((error as Error).message); }
    finally { setPresenceBusy(false); }
  }
  async function changeFriend(friend: string, add: boolean) {
    if (friendBusy) return;
    setFriendBusy(true);
    try {
      const result = await api(add ? '/friends/add' : '/friends/remove', { name: friend });
      setUsers(result.friends); setFoundFriend(null); setFriendMessage(add ? '好友申请已发送，等待对方同意' : '已从好友列表移除');
    } catch (error) { setFriendMessage((error as Error).message); }
    finally { setFriendBusy(false); }
  }
  useEffect(() => () => { events.current?.abort(); dc.current?.close(); pc.current?.close(); if (ackTimer.current) clearTimeout(ackTimer.current); }, []);
  function sendMove(from: [number, number], to: [number, number]) {
    const state = latest.current;
    if (roundEnding || !connected || !game.current || !dc.current || dc.current.readyState !== 'open' || state.turn !== side || pendingMove.current !== null) return false;
    const packet: MovePacket = { type: 'move', gameId: game.current.gameId, ply: state.ply, before: state.position, from, to };
    try { dc.current.send(JSON.stringify(packet)); pendingMove.current = state.ply + 1;
      ackTimer.current = setTimeout(() => { clearConnection(); setStatus('未收到落子确认，已锁定对局，请重连核对局面'); }, 10_000);
      return true;
    } catch { setConnected(false); setStatus('发送失败，落子未执行'); return false; }
  }
  const panel = <details ref={networkPanel} className="collapsible-module network-panel" open><summary>网络对战</summary><div className="collapsible-content" style={{ display: 'grid', gap: 8 }}>
    <style>{`.network-panel label{display:grid;gap:6px;font-size:13px;color:#365a47}.network-panel input{box-sizing:border-box;width:100%;min-height:40px;padding:8px 10px;border:1px solid #d9d3c4;border-radius:8px;background:#fff;font:inherit}.network-panel button{min-height:38px;padding:7px 12px;margin:3px 3px 3px 0;border:1px solid #c9d4c9;border-radius:8px;background:#edf3ed;color:#245f43;font:inherit;cursor:pointer}.network-panel button:disabled{opacity:.45;cursor:default}.network-panel p{font-size:14px;overflow-wrap:anywhere}.network-panel small{color:#77746b;line-height:1.6}`}</style>
    {!logged && <>
      <form onSubmit={e => { e.preventDefault(); void login(authMode === 'register'); }} style={{ display: 'grid', gap: 8 }}>
        <label>账号 <input aria-label="网络账号" required disabled={authBusy} autoComplete="username" value={name} onChange={e => setName(e.target.value)} /></label>
        <label>密码 <input aria-label="网络密码" required maxLength={128} disabled={authBusy} type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
        {authMode === 'register' && <label>确认密码 <input aria-label="确认密码" required maxLength={128} disabled={authBusy} type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>}
        <div role="group" aria-label="注册或登录">
          <button type={authMode === 'login' ? 'submit' : 'button'} disabled={authBusy} aria-pressed={authMode === 'login'} onClick={() => { if (authMode !== 'login') { setAuthMode('login'); setConfirmPassword(''); setStatus('请输入账号和密码'); } }}>登录</button>
          <button type={authMode === 'register' ? 'submit' : 'button'} disabled={authBusy} aria-pressed={authMode === 'register'} onClick={() => { if (authMode !== 'register') { setAuthMode('register'); setConfirmPassword(''); setStatus('创建账号，开始对战'); } }}>注册</button>
        </div>
      </form>
    </>}
    {!['未登录', '请输入账号和密码', '创建账号，开始对战', '已登录 · 等待邀请'].includes(status) && <p role="status">{status}{active ? ` · 你执${side === 'red' ? '红' : '黑'}` : ''}</p>}
    {logged && <>
      <section aria-label="账户信息">
        <strong>{session.current.nickname}（ID {session.current.id}）</strong>
        <small>等级分 {rating?.rating??1200}{(rating?.games??0)<20?' · 暂定':''} · {rating?.games??0} 场计分对局</small>
        <details><summary>修改名称</summary><input aria-label="账户名称" value={nickname} maxLength={32} onChange={e=>setNickname(e.target.value)} /><button onClick={()=>void api('/profile',{nickname}).then(result=>{session.current.nickname=result.nickname;setNickname(result.nickname);setStatus('名称已更新');}).catch(e=>setStatus(e.message))}>保存名称</button></details>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14 }}>账户状态：
          <select aria-label="账户状态" value={presence} disabled={presenceBusy} style={{ font: 'inherit', color: '#245f43', background: '#edf3ed', border: '1px solid #c9d4c9', borderRadius: 8, padding: '7px 12px' }} onChange={e => { if (e.target.value === 'logout') void logout(); else void changePresence(e.target.value as 'online' | 'invisible'); }}>
            <option value="online">在线</option>
            <option value="invisible">隐身</option>
            <option value="logout" disabled={active}>退出</option>
          </select>
        </label>
      </section>
      <button aria-expanded={showFriends} onClick={() => setShowFriends(value => !value)}>好友列表</button>
      {!active && <div aria-label="邀请对战设置" style={{display:'flex',flexWrap:'wrap',gap:12}}>
        <label>每方局时<select aria-label="每方局时" value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>{[5,10,15,30,45].map(n=><option key={n} value={n}>{n} 分钟</option>)}</select></label>
        <label>本局执棋<select aria-label="邀请执棋方" style={{font:'inherit',padding:8,minHeight:40}} value={inviteSide} onChange={e=>setInviteSide(e.target.value as Side)}><option value="red">执红</option><option value="black">执黑</option></select></label>
        <label>后续对局<select aria-label="下一局执棋设置" style={{font:'inherit',padding:8,minHeight:40}} value={swapSides?'swap':'keep'} onChange={e=>setSwapSides(e.target.value==='swap')}><option value="swap">交替执棋</option><option value="keep">一直执{inviteSide==='red'?'红':'黑'}</option></select></label>
      </div>}
      {!active && !watching && <button disabled={matching} onClick={()=>void api('/match/join',{minutes}).catch(e=>setStatus(e.message))}>自动匹配</button>}
      {matching && <button onClick={()=>void api('/match/leave',{}).then(()=>{setMatching(false);setStatus('已取消匹配');}).catch(e=>setStatus(e.message))}>取消匹配</button>}
      <button disabled={matching} onClick={()=>setShowFriends(true)}>邀请对战</button>
      {requests.map(request=><div key={request.name}>{request.nickname}（ID {request.id}）申请添加好友 <button onClick={()=>void api('/friends/respond',{name:request.name,accept:true}).catch(e=>setStatus(e.message))}>同意好友申请</button><button onClick={()=>void api('/friends/respond',{name:request.name,accept:false}).catch(e=>setStatus(e.message))}>拒绝好友申请</button></div>)}
      <button onClick={()=>void api('/history',{}).then(result=>setHistory(result.games)).catch(e=>setStatus(e.message))}>对局历史</button>
      {matchStats && <section aria-label="双方历史战绩"><strong>与 {matchStats.opponent.nickname}（ID {matchStats.opponent.id}）的历史战绩</strong><p>共 {matchStats.total} 局 · 你 {matchStats.wins} 胜 / {matchStats.losses} 负 / {matchStats.draws} 和</p><button onClick={()=>void api('/history',{opponentId:matchStats.opponent.id}).then(result=>setHistory(result.games)).catch(e=>setStatus(e.message))}>查看双方历史对局</button></section>}
      {history && <section aria-label="对局历史"><button onClick={()=>setHistory(null)}>收起历史</button>{history.length===0 && <p>暂无对局</p>}{active && <small>退出当前对战后可复盘分析。</small>}{history.map(row=><div key={row.id} style={{borderBottom:'1px solid #ddd',paddingBottom:8}}><p>{row.opponent?.nickname ?? '对手'}（ID {row.opponent?.id}） · {new Date(row.started).toLocaleString()} · {row.result==='red'?'红方胜':row.result==='black'?'黑方胜':row.result==='draw'?'和棋':row.result?.endsWith('-left')?'退出结束':row.result} · 用时 {Math.floor(row.duration/60000)}分{Math.floor(row.duration/1000)%60}秒</p>{row.ended && <button disabled={active || !row.hasRecord} onClick={()=>void api('/history/get',{id:row.id}).then(value=>latest.current.review?.(value.content)).catch(e=>setStatus(e.message))}>{row.hasRecord?'复盘分析':'无完整棋谱'}</button>}</div>)}</section>}
      {showFriends && <section aria-label="好友列表" style={{ display: 'grid', gap: 8 }}>
      <form onSubmit={e => { e.preventDefault(); void searchFriend(); }} style={{ display: 'grid', gap: 6 }}>
        <label>搜索用户 <input aria-label="搜索好友账号" required maxLength={32} value={friendQuery} onChange={e => { setFriendQuery(e.target.value); setFoundFriend(null); setFriendMessage(''); }} placeholder="输入数字ID或名称" /></label>
        <button disabled={friendBusy} type="submit">搜索</button>
      </form>
      {friendMessage && <small role="status">{friendMessage}</small>}
      {searchResults.length>1 && <div aria-label="匹配用户">{searchResults.map(user=><button key={user.id} onClick={()=>setFoundFriend(user)}>{user.nickname}（ID {user.id}） · {user.online?'在线':'离线'}</button>)}</div>}
      {foundFriend && <div>{foundFriend.nickname} · ID {foundFriend.id} · {foundFriend.online ? foundFriend.busy ? '对局中' : '在线' : '离线'} <button disabled={active || !foundFriend.online || foundFriend.busy} onClick={()=>void api('/invite',{to:foundFriend.name,side:inviteSide,swapSides,minutes}).then(()=>setStatus('邀请已发出')).catch(e=>setStatus(e.message))}>邀请对战</button><button disabled={friendBusy || foundFriend.added} onClick={() => void changeFriend(foundFriend.name, true)}>{foundFriend.added ? '已添加' : '添加好友'}</button></div>}
      {users.length === 0 && <small>暂无好友</small>}
      {users.map(u => <div key={u.name} data-friend={u.name} role="group" aria-label={`${u.nickname}的好友卡片`} style={{ border: '1px solid #c9d4c9', borderRadius:12,background:'#f7faf5',padding:12,display:'grid',gap:8 }}>
        <span style={{fontWeight:600,color:'#245f43'}}>{u.nickname} · ID {u.id} · {u.online ? u.busy ? '对局中' : '在线' : '离线'}</span><div style={{display:'flex',flexWrap:'wrap',gap:6,borderTop:'1px solid #dde5d9',paddingTop:8}}>
          <button disabled={active || !!watching || !u.online || u.busy} onClick={() => void api('/invite', { to: u.name, side:inviteSide,swapSides,minutes }).then(() => setStatus('邀请已发出，等待对手接受')).catch(e => setStatus(e.message))}>邀请对战</button>
          {u.busy && <button disabled={active || !!watching} onClick={()=>{setWatching(u.name);setStatus(`正在观看 ${u.nickname} 的对局`);}}>观看对弈</button>}
          <span>等级分 {u.rating??1200}{u.provisional?' · 暂定':''}</span><button aria-expanded={friendDetails === u.name} onClick={() => setFriendDetails(friendDetails === u.name ? null : u.name)}>好友信息</button>
          <button disabled={friendBusy} onClick={() => void changeFriend(u.name, false)}>移除好友</button>
        </div>
        {friendDetails === u.name && <div aria-label={`${u.name} 的好友信息`}><p>好友账号：{u.name}</p><p>当前状态：{u.online ? u.busy ? '对局中' : '在线' : '离线'}</p></div>}
      </div>)}
      </section>}
    </>}
    {invitation && !active && <section ref={inviteDialog} role="alert" aria-label="对战邀请" style={{background:'#fff8df',border:'2px solid #c69530',borderRadius:12,padding:16,scrollMarginBlock:24}}>
      <h3>收到对战邀请</h3><p>{invitation.fromProfile?.nickname??invitation.from}{invitation.fromProfile && `（ID ${invitation.fromProfile.id}）`} 邀请你对战</p>
      <p>本局你执{invitation.side==='black'?'红':'黑'}；每方 {invitation.minutes??15} 分钟；下一局{invitation.swapSides===false?'保持执棋方':'红黑互换'}。</p>
      <div style={{display:'flex',gap:12}}><button style={{flex:1,background:'#176b45',color:'white',fontWeight:700,minHeight:48}} onClick={() => void api('/respond', { id: invitation.id, accept: true }).catch(e => {setStatus(e.message);setInvitation(null);})}>接受</button><button style={{flex:1,background:'#fff0ed',color:'#a32d23',borderColor:'#a32d23',fontWeight:700,minHeight:48}} onClick={() => void api('/respond', { id: invitation.id, accept: false }).then(() => setInvitation(null)).catch(e => {setStatus(e.message);setInvitation(null);})}>拒绝</button></div>
    </section>}
    {watching && <button onClick={()=>{setWatching(null);setStatus('已退出观战');}}>退出观战</button>}
  </div></details>;
  const responseCard=(kind:'time'|'undo'|'draw',question:string,acceptLabel:string,rejectLabel:string)=><div role="alert" data-request={kind} className="duel-request"><strong>{question}</strong><div><button onClick={()=>respond(kind,true)}>{acceptLabel}</button><button onClick={()=>respond(kind,false)}>{rejectLabel}</button></div></div>;
  function respond(kind:string,accept:boolean){
    if(!['time','undo','draw'].includes(kind))return;
    void api(`/${kind}/respond`,{gameId:game.current?.gameId,accept,content:kind==='draw'?latest.current.record?.():undefined}).then(()=>{
      if(kind==='time')setTimeOffer(false);else if(kind==='undo')setUndoOffer(false);else setDrawOffer(false);
    }).catch(e=>setStatus(e.message));
  }
  const operations=active && <section ref={operationsRef} className="duel-operations" aria-label="对局操作区">
    {roundEnding && <div className="duel-request" data-request="rematch" role="alert"><strong>{status}</strong><button onClick={()=>void api('/rematch',{gameId:game.current?.gameId}).catch(e=>setStatus(e.message))}>再来一局</button><button onClick={()=>void leave()}>退出</button></div>}
    {(peerOffline || linkLost) && <div role="alert" className="duel-request">{peerOffline ? '对方已断线，等待重连；5分钟内未恢复将结束对局。' : '与对方连接已中断，棋局已锁定；请等待恢复或点击重连。'}{peerOffline && connected && <small> 已建立的直连仍可继续行棋。</small>}</div>}
    {active && <details><summary>对局操作</summary><div>
      {!roundEnding && <button onClick={()=>void api('/time/offer',{gameId:game.current?.gameId}).then(()=>setStatus('已申请双方各加时5分钟，等待对方同意')).catch(e=>setStatus(e.message))}>申请加时</button>}
      {!roundEnding && <><button disabled={options.ply===0} onClick={()=>void api('/undo/offer',{gameId:game.current?.gameId,content:latest.current.record?.()}).then(()=>setStatus('已申请悔棋，等待对方同意')).catch(e=>setStatus(e.message))}>悔棋</button><button onClick={()=>void api('/draw/offer',{gameId:game.current?.gameId}).then(()=>setStatus('已提和，等待对方回应')).catch(e=>setStatus(e.message))}>提和</button><button onClick={()=>{if(window.confirm('确认认输？')) void api('/resign',{gameId:game.current?.gameId,content:latest.current.record?.()}).catch(e=>setStatus(e.message));}}>认输</button></>}
      <button onClick={()=>void leave()}>退出对局</button>
    </div></details>}
    {timeOffer && !roundEnding && responseCard('time','对方申请双方各加时5分钟','同意加时','拒绝加时')}
    {undoOffer && !roundEnding && responseCard('undo','对方申请悔棋','同意悔棋','拒绝悔棋')}
    {drawOffer && !roundEnding && responseCard('draw','对方提和','同意和棋','拒绝和棋')}
    {active && !connected && <button onClick={() => void signal('restart').then(() => connect(true)).catch(e => setStatus(e.message))}>重连并核对局面</button>}
  </section>;
  const clockPanel=(color:Side)=>{
    const moving=clock?.turn===color&&!clock.ended;
    const urgent=moving&&(clock?.stepRemaining??Infinity)<=5000;
    const remaining=clock?.stepRemaining;
    return active && <div aria-label={`${color==='red'?'红':'黑'}方计时`} style={{padding:12,borderRadius:16,background:moving?'#e3efe5':'#f4f1e9',display:'flex',alignItems:'center',gap:12,fontVariantNumeric:'tabular-nums'}}>
      <div style={{textAlign:'center',flexShrink:0}}><div style={{position:'relative',width:64,height:64,display:'grid',placeItems:'center'}}>
        <svg width="64" height="64" style={{position:'absolute',inset:0,transform:'rotate(-90deg)'}} aria-hidden="true"><circle cx="32" cy="32" r="28" fill="none" stroke="#d6dfd8" strokeWidth="4"/><circle cx="32" cy="32" r="28" fill="none" stroke={urgent?'#c62828':'#176b45'} strokeWidth="4" strokeDasharray="176" strokeDashoffset={176*(1-(moving&&remaining!==undefined?Math.min(1,remaining/(clock?.stepLimit??30000)):0))}/></svg>
        {moving&&remaining!==undefined?<b className={`step-seconds ${urgent?'step-urgent':''}`} aria-label="当前步剩余秒数">{Math.ceil(remaining/1000)}</b>:<strong style={{fontSize:24,color:color==='red'?'#b73a32':'#24362d'}}>{color==='red'?'红':'黑'}</strong>}
      </div><strong aria-label="总剩余时间">{clock?formatTime(Math.max(0,clock.limit-clock.used[color])):'—'}</strong></div>
      <div style={{minWidth:0}}><strong style={{overflowWrap:'anywhere'}}>{game.current?.[color]??(color==='red'?'红方':'黑方')}</strong><div style={{fontSize:12,color:'#778078',marginTop:4}}>{color==='red'?'红方':'黑方'} · 已用 {clock?formatTime(clock.used[color]):'—'}</div></div>
    </div>;
  };
  function formatTime(ms:number){const s=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
  return { operations, peerSelected, clockPanel, active:active || !!watching, watching:!!watching, side, connected, sendMove, panel, logged, finishRound: (result: Side | 'draw')=>game.current ? api('/next-game',{gameId:game.current.gameId,result,content:latest.current.record?.()}).then(()=>setStatus('本局结束，双方同意后开始下一局')) : Promise.resolve(), account: logged ? session.current.name : '', accountApi: api };
}
