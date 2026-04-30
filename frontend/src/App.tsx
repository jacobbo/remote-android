import type React from "react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, ApiError, setToken, type AuthUser, type Device, type PairingToken, type Role, type SessionRow } from "./services/api";
import {
  connectHub,
  disconnectHub,
  watchDevice,
  stopWatching,
  forceDisconnect as sfForceDisconnect,
  sendInput,
  sendSdpAnswer,
  sendIceCandidate,
  setWebRtcHandlers,
} from "./services/signalr";

// Demo accounts (hints only — real auth happens via the backend)
const DEMO_ACCOUNTS = [
  { username: "admin", password: "admin", role: "admin" },
  { username: "user1", password: "user1", role: "user" },
  { username: "user2", password: "user2", role: "user" },
];

// ─────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
:root{
  --b0:#07080a;--b1:#0e1013;--b2:#151820;--b3:#1c2029;--bh:#232834;--ba:#131825;
  --br:#222833;--brh:#343b4a;
  --f:#e0e4ec;--f2:#8a91a0;--f3:#4e5566;
  --blue:#4c8df5;--blued:rgba(76,141,245,.1);
  --grn:#2dd4a0;--amb:#f0a030;--red:#e84545;
  --m:'IBM Plex Mono',monospace;--s:'Outfit',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--b0)}::-webkit-scrollbar-thumb{background:var(--br);border-radius:3px}
@keyframes fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes sh{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes gl{0%,100%{opacity:.25}50%{opacity:.55}}
@keyframes pr{0%{box-shadow:0 0 0 0 rgba(76,141,245,.35)}70%{box-shadow:0 0 0 7px rgba(76,141,245,0)}100%{box-shadow:0 0 0 0 rgba(76,141,245,0)}}
`;

// ─────────────────────────────────────────────────────
// ATOMS
// ─────────────────────────────────────────────────────
const Batt=({l})=>{const c=l<=20?"var(--red)":l<=50?"var(--amb)":"var(--grn)";return<svg width="18" height="10" viewBox="0 0 20 11"><rect x=".5" y=".5" width="15" height="10" rx="2" fill="none" stroke="var(--f3)" strokeWidth="1"/><rect x="16" y="3" width="3" height="5" rx="1" fill="var(--f3)"/><rect x="2" y="2" width={Math.max(0,l/100*11.5)} height="7" rx="1" fill={c}/></svg>};
const Sig=({l})=><svg width="13" height="11" viewBox="0 0 14 12">{[0,1,2,3,4].map(i=><rect key={i} x={i*2.8} y={12-(i+1)*2.4} width="2" height={(i+1)*2.4} rx=".4" fill={i<l?"var(--grn)":"var(--b3)"}/>)}</svg>;
const Dot=({s})=>{const c=s==="online"?"var(--grn)":s==="idle"?"var(--amb)":"var(--f3)";return<span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:7,height:7,borderRadius:"50%",background:c,boxShadow:s==="online"?`0 0 6px ${c}`:"none"}}/><span style={{fontSize:9,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".07em",fontWeight:600}}>{s}</span></span>};
const RB=({r})=>{const a=r==="admin";return<span style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",padding:"2px 6px",borderRadius:3,background:a?"var(--blued)":"rgba(78,85,102,.12)",color:a?"var(--blue)":"var(--f3)",border:`1px solid ${a?"rgba(76,141,245,.18)":"rgba(78,85,102,.18)"}`}}>{r}</span>};
const Ico=({d,sz=14})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;

const ago=(ts:number|null)=>{if(!ts)return"";const d=Date.now()-ts;if(d<60000)return"now";if(d<3600000)return Math.floor(d/60000)+"m ago";if(d<86400000)return Math.floor(d/3600000)+"h ago";return Math.floor(d/86400000)+"d ago"};
const fmtDur=(ms:number)=>{const s=Math.floor(ms/1000),m=Math.floor(s/60);return`${m}:${(s%60).toString().padStart(2,"0")}`};

const Btn=({children,onClick,variant="default",disabled=false,full=false}:any)=>{
  const bg={default:"var(--b2)",primary:"var(--blue)",danger:"rgba(232,69,69,.12)",ghost:"transparent"}[variant];
  const fg={default:"var(--f2)",primary:"#fff",danger:"var(--red)",ghost:"var(--f2)"}[variant];
  const hv={default:"var(--bh)",primary:"rgba(76,141,245,.85)",danger:"rgba(232,69,69,.2)",ghost:"var(--b2)"}[variant];
  return<button onClick={disabled?undefined:onClick} style={{all:"unset",boxSizing:"border-box",cursor:disabled?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px 16px",borderRadius:7,background:bg,color:fg,fontSize:12,fontWeight:600,fontFamily:"var(--s)",border:variant==="ghost"?"1px solid var(--br)":"none",transition:"all .15s",opacity:disabled?.4:1,width:full?"100%":undefined,textAlign:"center"}} onMouseEnter={e=>{if(!disabled)(e.currentTarget as HTMLElement).style.background=hv as string}} onMouseLeave={e=>{if(!disabled)(e.currentTarget as HTMLElement).style.background=bg as string}}>{children}</button>
};

// ─────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────
const Login=({onLogin}:{onLogin:(u:AuthUser,t:string)=>void})=>{
  const[u,sU]=useState("");const[p,sP]=useState("");const[e,sE]=useState("");const[sk,sSk]=useState(false);const[busy,sBusy]=useState(false);
  const go=async()=>{
    if(busy)return;
    sBusy(true);sE("");
    try{
      const{token,user}=await api.login(u,p);
      onLogin(user,token);
    }catch(err){
      const msg=err instanceof ApiError&&err.status===401?"Invalid credentials":err instanceof Error?err.message:"Login failed";
      sE(msg);sSk(true);setTimeout(()=>sSk(false),500);
    }finally{sBusy(false)}
  };
  const I={width:"100%",padding:"9px 12px",borderRadius:6,background:"var(--b2)",border:"1px solid var(--br)",color:"var(--f)",fontSize:13,fontFamily:"var(--s)",outline:"none",transition:"border .15s"};
  return<div style={{width:"100%",height:"100vh",background:"var(--b0)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--s)"}}>
    <div style={{width:350,padding:32,background:"var(--b1)",borderRadius:12,border:"1px solid var(--br)",boxShadow:"0 20px 60px rgba(0,0,0,.5)",animation:sk?"sh .4s":"fu .5s"}}>
      <div style={{textAlign:"center",marginBottom:24}}><div style={{width:40,height:40,borderRadius:9,background:"var(--blued)",display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:8}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div><h1 style={{fontSize:17,fontWeight:700,color:"var(--f)"}}>Remote Desktop</h1><p style={{fontSize:11,color:"var(--f3)",marginTop:3}}>Sign in to continue</p></div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div><label style={{fontSize:10,fontWeight:600,color:"var(--f2)",display:"block",marginBottom:4}}>Username</label><input value={u} onChange={x=>{sU(x.target.value);sE("")}} style={I} onFocus={x=>(x.target as HTMLInputElement).style.borderColor="var(--blue)"} onBlur={x=>(x.target as HTMLInputElement).style.borderColor="var(--br)"}/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:"var(--f2)",display:"block",marginBottom:4}}>Password</label><input type="password" value={p} onChange={x=>{sP(x.target.value);sE("")}} style={I} onFocus={x=>(x.target as HTMLInputElement).style.borderColor="var(--blue)"} onBlur={x=>(x.target as HTMLInputElement).style.borderColor="var(--br)"} onKeyDown={x=>x.key==="Enter"&&go()}/></div>
        {e&&<div style={{padding:"6px 10px",borderRadius:5,background:"rgba(232,69,69,.07)",border:"1px solid rgba(232,69,69,.13)",color:"var(--red)",fontSize:11}}>{e}</div>}
        <Btn variant="primary" onClick={go} full disabled={busy}>{busy?"Signing in…":"Sign In"}</Btn>
      </div>
      <div style={{marginTop:18,padding:9,background:"var(--b2)",borderRadius:6,border:"1px solid var(--br)"}}>
        <span style={{fontSize:8,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",fontWeight:600}}>Demo Accounts</span>
        <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:5}}>{DEMO_ACCOUNTS.map(x=><button key={x.username} onClick={()=>{sU(x.username);sP(x.password);sE("")}} style={{all:"unset",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 6px",borderRadius:3,transition:"background .1s"}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background="var(--bh)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background="transparent"}><span style={{fontSize:10,color:"var(--f2)",fontFamily:"var(--m)"}}>{x.username}/{x.password}</span><RB r={x.role}/></button>)}</div>
      </div>
    </div>
  </div>
};

// ─────────────────────────────────────────────────────
// USER MENU
// ─────────────────────────────────────────────────────
const UserMenu=({user,onLogout,onOpenUsers}:{user:AuthUser;onLogout:()=>void;onOpenUsers:()=>void})=>{
  const[o,sO]=useState(false);const r=useRef<HTMLDivElement>(null);
  useEffect(()=>{const h=(e:MouseEvent)=>{if(r.current&&!r.current.contains(e.target as Node))sO(false)};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h)},[]);
  const ini=user.displayName.split(" ").map(n=>n[0]).join("");const adm=user.role==="admin";
  return<div ref={r} style={{position:"relative"}}>
    <button onClick={()=>sO(!o)} style={{all:"unset",cursor:"pointer",display:"flex",alignItems:"center",gap:6,padding:"3px 6px 3px 3px",borderRadius:6,transition:"background .15s"}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background="var(--b2)"} onMouseLeave={e=>{if(!o)(e.currentTarget as HTMLElement).style.background="transparent"}}>
      <div style={{width:24,height:24,borderRadius:5,background:adm?"var(--blued)":"var(--b2)",border:`1px solid ${adm?"rgba(76,141,245,.22)":"var(--br)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:adm?"var(--blue)":"var(--f3)"}}>{ini}</div>
      <span style={{fontSize:11,color:"var(--f2)",fontWeight:500}}>{user.displayName}</span>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--f3)" strokeWidth="2.5" style={{transform:o?"rotate(180deg)":"none",transition:"transform .15s"}}><path d="M6 9l6 6 6-6"/></svg>
    </button>
    {o&&<div style={{position:"absolute",top:"calc(100% + 4px)",right:0,width:200,background:"var(--b1)",border:"1px solid var(--br)",borderRadius:8,boxShadow:"0 8px 28px rgba(0,0,0,.4)",overflow:"hidden",zIndex:100,animation:"fi .1s"}}>
      <div style={{padding:"10px 12px",borderBottom:"1px solid var(--br)"}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}><span style={{fontSize:11,fontWeight:600,color:"var(--f)"}}>{user.displayName}</span><RB r={user.role}/></div><span style={{fontSize:9,color:"var(--f3)"}}>{user.email}</span></div>
      <div style={{padding:4}}>
        {adm&&<MItem label="Manage Users" onClick={()=>{sO(false);onOpenUsers()}}/>}{adm&&<MItem label="Settings"/>}
        <div style={{height:1,background:"var(--br)",margin:"3px 0"}}/>
        <button onClick={()=>{sO(false);onLogout()}} style={{all:"unset",cursor:"pointer",width:"100%",display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:4,fontSize:10,color:"var(--red)",transition:"background .1s"}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background="rgba(232,69,69,.07)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background="transparent"}><Ico d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" sz={12}/>Sign Out</button>
      </div>
    </div>}
  </div>
};
const MItem=({label,onClick}:{label:string;onClick?:()=>void})=><button onClick={onClick} style={{all:"unset",cursor:"pointer",width:"100%",display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:4,fontSize:10,color:"var(--f2)",transition:"background .1s"}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background="var(--b2)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background="transparent"}>{label}</button>;

// ─────────────────────────────────────────────────────
// DEVICE CARD
// ─────────────────────────────────────────────────────
const DeviceCard=({d,onClick}:{d:Device;onClick:(d:Device)=>void})=>{
  const on=d.status==="online",off=d.status==="offline";
  const sc=on?"var(--grn)":d.status==="idle"?"var(--amb)":"var(--f3)";
  const cu=d.connectedUser;
  return<button onClick={()=>onClick(d)} style={{all:"unset",cursor:"pointer",display:"flex",flexDirection:"column",height:cu?184:164,width:"100%",background:"var(--b1)",border:`1px solid ${cu?"rgba(76,141,245,.2)":"var(--br)"}`,borderRadius:9,overflow:"hidden",transition:"all .2s",boxShadow:cu?"0 0 0 1px rgba(76,141,245,.1),0 2px 12px rgba(0,0,0,.2)":"0 2px 8px rgba(0,0,0,.12)",opacity:off?.55:1}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.borderColor=cu?"rgba(76,141,245,.35)":"var(--f3)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.borderColor=cu?"rgba(76,141,245,.2)":"var(--br)"}>
    <div style={{padding:"14px 12px 10px",display:"flex",alignItems:"center",gap:9,borderBottom:"1px solid var(--br)"}}>
      <div style={{width:30,height:30,borderRadius:6,flexShrink:0,background:`${sc}12`,display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={sc} strokeWidth="1.8"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div>
      <div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"var(--f)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</div><div style={{fontSize:9,color:"var(--f3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.model}</div></div>
    </div>
    <div style={{padding:"8px 12px",display:"flex",flexDirection:"column",gap:6,flex:1}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><Dot s={d.status}/>{!on&&d.lastSeen&&<span style={{fontSize:8,color:"var(--f3)",fontFamily:"var(--m)"}}>{ago(d.lastSeen)}</span>}</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:4}}><Batt l={d.battery??0}/><span style={{fontSize:9,color:"var(--f3)"}}>{d.battery??0}%</span></div><Sig l={d.signal??0}/></div>
      <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:8,color:"var(--f3)"}}>{d.os}</span><span style={{fontSize:8,color:"var(--f3)",fontFamily:"var(--m)"}}>{d.ip}</span></div>
    </div>
    {cu&&<div style={{padding:"6px 12px",borderTop:"1px solid var(--br)",background:"rgba(76,141,245,.04)",display:"flex",alignItems:"center",gap:5}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:"var(--blue)",animation:"pr 2s infinite"}}/>
      <span style={{fontSize:9,color:"var(--blue)",fontWeight:500}}>{cu.displayName} connected</span>
    </div>}
  </button>
};

// ─────────────────────────────────────────────────────
// DEVICE DETAIL VIEW
// ─────────────────────────────────────────────────────
const DeviceDetail=({device,user,onBack,onConnect}:{device:Device;user:AuthUser;onBack:()=>void;onConnect:(d:Device)=>void})=>{
  const cu=device.connectedUser;
  const isMeConnected=cu&&cu.id===user.id;
  const otherConnected=cu&&cu.id!==user.id;
  const canConnect=device.status==="online"&&!cu;
  const isAdmin=user.role==="admin";
  const[elapsed,setElapsed]=useState(cu?Date.now()-cu.since:0);
  const[sessions,setSessions]=useState<SessionRow[]>([]);
  const[loadingSessions,setLoadingSessions]=useState(true);

  useEffect(()=>{if(!cu)return;setElapsed(Date.now()-cu.since);const i=setInterval(()=>setElapsed(Date.now()-cu.since),1000);return()=>clearInterval(i)},[cu]);
  useEffect(()=>{
    let cancel=false;
    setLoadingSessions(true);
    api.deviceSessions(device.id).then(s=>{if(!cancel){setSessions(s);setLoadingSessions(false)}}).catch(()=>{if(!cancel)setLoadingSessions(false)});
    return()=>{cancel=true};
  },[device.id]);

  const handleDisconnect=async()=>{try{await stopWatching(device.id)}catch{/* hub may be disconnected */}};
  const handleForceDisconnect=async()=>{try{await sfForceDisconnect(device.id)}catch{/* ignore */}};

  const[adminBusy,sAdminBusy]=useState(false);
  const[confirmRevoke,sConfirmRevoke]=useState(false);
  const[confirmRemove,sConfirmRemove]=useState(false);
  const handleRevoke=async()=>{
    sAdminBusy(true);
    try{await api.revokeDevice(device.id);sConfirmRevoke(false)}
    catch(e:any){alert(e?.message??"Revoke failed")}
    finally{sAdminBusy(false)}
  };
  const handleRemove=async()=>{
    sAdminBusy(true);
    try{await api.deleteDevice(device.id);sConfirmRemove(false);onBack()}
    catch(e:any){alert(e?.message??"Remove failed");sAdminBusy(false)}
  };

  // Inline name edit — admins only. The committed value lives on the device
  // (refreshed via DeviceListUpdated push), so we mirror it locally for the
  // input and only persist when the user blurs/Enter with a changed value.
  const[nameDraft,sNameDraft]=useState(device.name);
  const[nameSaving,sNameSaving]=useState(false);
  useEffect(()=>{sNameDraft(device.name)},[device.name]);
  const commitRename=async()=>{
    const v=nameDraft.trim();
    if(!v||v===device.name){sNameDraft(device.name);return}
    sNameSaving(true);
    try{await api.renameDevice(device.id,v)}
    catch(e:any){sNameDraft(device.name);alert(e?.message??"Rename failed")}
    finally{sNameSaving(false)}
  };

  const Info=({label,val})=><div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--br)"}}><span style={{fontSize:11,color:"var(--f3)"}}>{label}</span><span style={{fontSize:11,color:"var(--f)",fontFamily:"var(--m)"}}>{val}</span></div>;
  const reasonColor=(r:string)=>(({user:"var(--grn)",admin:"var(--amb)",network:"var(--red)",timeout:"var(--f3)",deviceoffline:"var(--red)"} as any)[r]||"var(--f3)");

  return<div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--b0)",animation:"fu .25s"}}>
    {/* Header */}
    <div style={{padding:"12px 20px",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
      <button onClick={onBack} style={{all:"unset",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:"var(--f2)",fontSize:11,fontWeight:500}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color="var(--f)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color="var(--f2)"}><Ico d="M19 12H5M12 19l-7-7 7-7"/>Dashboard</button>
      <span style={{color:"var(--br)"}}>|</span>
      <Dot s={device.status}/>
      <span style={{fontSize:14,fontWeight:700,color:"var(--f)"}}>{device.name}</span>
    </div>

    {/* Content */}
    <div style={{flex:1,overflow:"auto",padding:24,display:"flex",gap:20}}>
      <div style={{width:320,flexShrink:0,display:"flex",flexDirection:"column",gap:16}}>
        <div style={{background:"var(--b1)",borderRadius:9,border:"1px solid var(--br)",padding:16}}>
          <h3 style={{fontSize:11,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Device Info</h3>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--br)",gap:10}}>
            <span style={{fontSize:11,color:"var(--f3)",flexShrink:0}}>Name</span>
            {isAdmin?(
              <input
                value={nameDraft}
                disabled={nameSaving}
                maxLength={100}
                onChange={e=>sNameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e=>{if(e.key==="Enter"){(e.target as HTMLInputElement).blur()}else if(e.key==="Escape"){sNameDraft(device.name);(e.target as HTMLInputElement).blur()}}}
                style={{all:"unset",fontSize:11,color:"var(--f)",fontFamily:"var(--m)",textAlign:"right",flex:1,minWidth:0,padding:"2px 4px",borderRadius:3,background:nameSaving?"var(--b2)":"transparent",cursor:"text"}}
              />
            ):(
              <span style={{fontSize:11,color:"var(--f)",fontFamily:"var(--m)"}}>{device.name}</span>
            )}
          </div>
          <Info label="Model" val={device.model}/>
          <Info label="OS" val={device.os}/>
          <Info label="Resolution" val={device.resolution}/>
          <Info label="IP Address" val={device.ip}/>
          <div style={{display:"flex",alignItems:"center",gap:12,marginTop:10}}>
            <div style={{display:"flex",alignItems:"center",gap:4}}><Batt l={device.battery??0}/><span style={{fontSize:10,color:"var(--f3)"}}>{device.battery??0}%</span></div>
            <Sig l={device.signal??0}/>
          </div>
        </div>

        <div style={{background:"var(--b1)",borderRadius:9,border:`1px solid ${cu?"rgba(76,141,245,.2)":"var(--br)"}`,padding:16}}>
          <h3 style={{fontSize:11,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Active Session</h3>
          {cu?(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"var(--blue)",animation:"pr 2s infinite"}}/>
                <span style={{fontSize:13,fontWeight:600,color:"var(--f)"}}>{cu.displayName}</span>
              </div>
              <div style={{fontSize:11,color:"var(--f3)"}}>Connected for <span style={{color:"var(--blue)",fontFamily:"var(--m)",fontWeight:600}}>{fmtDur(elapsed)}</span></div>
            </div>
          ):(
            <div style={{fontSize:12,color:"var(--f3)"}}>No one connected</div>
          )}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {canConnect&&<Btn variant="primary" onClick={()=>onConnect(device)} full><Ico d="M5 12h14M12 5l7 7-7 7" sz={13}/>Connect</Btn>}
          {isMeConnected&&<Btn variant="danger" onClick={handleDisconnect} full><Ico d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" sz={13}/>Disconnect</Btn>}
          {otherConnected&&!isAdmin&&<Btn disabled full>In use by {cu!.displayName}</Btn>}
          {otherConnected&&isAdmin&&<Btn variant="danger" onClick={handleForceDisconnect} full><Ico d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" sz={13}/>Force Disconnect {cu!.displayName}</Btn>}
          {device.status==="offline"&&<Btn disabled full>Device offline</Btn>}
          {device.status==="idle"&&!cu&&<Btn disabled full>Device idle</Btn>}
        </div>

        {isAdmin&&<div style={{background:"var(--b1)",borderRadius:9,border:"1px solid var(--br)",padding:16,display:"flex",flexDirection:"column",gap:8}}>
          <h3 style={{fontSize:11,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em"}}>Admin</h3>
          <div style={{fontSize:10,color:"var(--f3)",lineHeight:1.5}}>Revoke trust (forces re-pairing via QR but keeps connection history) or remove the device entirely (wipes the record and its history).</div>
          <Btn variant="ghost" onClick={()=>sConfirmRevoke(true)} disabled={adminBusy} full>Revoke trust</Btn>
          <Btn variant="danger" onClick={()=>sConfirmRemove(true)} disabled={adminBusy} full>Remove device</Btn>
        </div>}
      </div>

      <div style={{flex:1,background:"var(--b1)",borderRadius:9,border:"1px solid var(--br)",padding:16,display:"flex",flexDirection:"column"}}>
        <h3 style={{fontSize:11,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:12}}>Connection History</h3>
        <div style={{flex:1,overflow:"auto"}}>
          {loadingSessions?<div style={{color:"var(--f3)",fontSize:11,padding:8}}>Loading…</div>:sessions.length===0?<div style={{color:"var(--f3)",fontSize:11,padding:8}}>No sessions yet</div>:
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{borderBottom:"1px solid var(--br)"}}>
              {["User","Started","Ended","Duration","Reason"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:9,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".05em"}}>{h}</th>)}
            </tr></thead>
            <tbody>{sessions.map(s=><tr key={s.id} style={{borderBottom:"1px solid var(--br)"}}>
              <td style={{padding:"8px 8px",color:"var(--f)",fontWeight:500}}>{s.user}</td>
              <td style={{padding:"8px 8px",color:"var(--f3)",fontFamily:"var(--m)",fontSize:10}}>{s.started}</td>
              <td style={{padding:"8px 8px",color:"var(--f3)",fontFamily:"var(--m)",fontSize:10}}>{s.ended??"—"}</td>
              <td style={{padding:"8px 8px",color:"var(--f2)",fontFamily:"var(--m)",fontSize:10}}>{s.duration}</td>
              <td style={{padding:"8px 8px"}}><span style={{fontSize:9,fontWeight:600,color:reasonColor(s.reason.replace("_","")),textTransform:"uppercase"}}>{s.reason}</span></td>
            </tr>)}</tbody>
          </table>}
        </div>
      </div>
    </div>

    {confirmRevoke&&<ConfirmModal
      title="Revoke device"
      body={<>This will end any active session, mark <span style={{color:"var(--f)",fontWeight:600}}>{device.name}</span> as untrusted, and stop the agent on the phone. The user will need to re-pair before reconnecting.</>}
      confirmLabel="Revoke"
      onCancel={()=>sConfirmRevoke(false)}
      onConfirm={handleRevoke}
      busy={adminBusy}/>}
    {confirmRemove&&<ConfirmModal
      title="Remove device"
      body={<>This permanently removes <span style={{color:"var(--f)",fontWeight:600}}>{device.name}</span> from the dashboard, deletes its trust key, ends any active session, and wipes its connection history. The phone agent will be told to unpair on next contact.</>}
      confirmLabel="Remove"
      onCancel={()=>sConfirmRemove(false)}
      onConfirm={handleRemove}
      busy={adminBusy}/>}
  </div>
};

// ─────────────────────────────────────────────────────
// REMOTE VIEW
// ─────────────────────────────────────────────────────
const Ctrl=({children,label,onClick,danger=false}:any)=><button onClick={onClick} title={label} style={{all:"unset",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"6px 9px",borderRadius:6,background:danger?"rgba(232,69,69,.08)":"var(--b2)",color:danger?"var(--red)":"var(--f2)",transition:"all .12s",fontSize:8,fontWeight:500}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=danger?"rgba(232,69,69,.15)":"var(--bh)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=danger?"rgba(232,69,69,.08)":"var(--b2)"}>{children}<span>{label}</span></button>;

// Maps a normalized click position on the video element to phone-pixel
// coordinates. The agent rescales the captured stream's resolution but injects
// input on the real display, so we always send pixels in the device's native
// resolution (parsed from `device.resolution`, with a sensible fallback).
const parseResolution = (s: string | null): [number, number] => {
  const m = s?.match(/^(\d+)\s*[x×]\s*(\d+)/i);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1080, 2400];
};

const RemoteView=({device,iceServers,onBack}:{device:Device;iceServers:RTCIceServer[];onBack:()=>void})=>{
  const videoRef=useRef<HTMLVideoElement>(null);
  const overlayRef=useRef<HTMLDivElement>(null);
  const pcRef=useRef<RTCPeerConnection|null>(null);
  const [log,sLog]=useState<{t:string;d:string;ts:number}[]>([]);
  const [conn,sConn]=useState(true);
  const [st,sSt]=useState(0);
  const [phoneW,phoneH]=useMemo(()=>parseResolution(device.resolution),[device.resolution]);

  const addLog=useCallback((t:string,d:string)=>sLog(p=>[...p.slice(-4),{t,d,ts:Date.now()}]),[]);

  // Build the peer connection once per device.id and route signaling through
  // the shared SignalR hub. ICE servers are minted server-side per session
  // and arrive as part of the WatchDevice response — empty array means
  // host-only candidates (LAN). Cleanup tears down both sides on unmount.
  useEffect(()=>{
    const pc=new RTCPeerConnection({iceServers});
    pcRef.current=pc;

    pc.ontrack=(ev)=>{
      const v=videoRef.current;
      if(v&&ev.streams[0]) v.srcObject=ev.streams[0];
      // Receiving a track is a reliable "media is flowing" signal. Chrome
      // sometimes never flips connectionState to "connected" even when video
      // plays, which would leave taps gated forever.
      sConn(false);
    };
    pc.onicecandidate=(ev)=>{
      if(!ev.candidate) return;
      sendIceCandidate(device.id,{
        candidate:ev.candidate.candidate,
        sdpMid:ev.candidate.sdpMid,
        sdpMLineIndex:ev.candidate.sdpMLineIndex,
      })?.catch(()=>{});
    };
    pc.onconnectionstatechange=()=>{
      const s=pc.connectionState;
      if(s==="connected") sConn(false);
      else if(s==="failed"||s==="closed") sConn(true);
    };
    pc.oniceconnectionstatechange=()=>{
      const s=pc.iceConnectionState;
      if(s==="connected"||s==="completed") sConn(false);
    };

    setWebRtcHandlers({
      onSdpOffer: async (devId,sdp) => {
        if(devId!==device.id) return;
        try {
          await pc.setRemoteDescription({type:"offer",sdp});
          const answer=await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSdpAnswer(device.id,answer.sdp??"");
        } catch (e) { console.warn("WebRTC answer failed",e); }
      },
      onIceCandidate: async (devId,c) => {
        if(devId!==device.id||!c.candidate) return;
        try {
          await pc.addIceCandidate({
            candidate: c.candidate,
            sdpMid: c.sdpMid ?? undefined,
            sdpMLineIndex: c.sdpMLineIndex ?? undefined,
          });
        } catch (e) { console.warn("addIceCandidate failed",e); }
      },
    });

    return ()=>{
      setWebRtcHandlers(null);
      try { pc.close(); } catch { /* ignore */ }
      pcRef.current=null;
    };
  },[device.id]);

  useEffect(()=>{if(conn)return;const i=setInterval(()=>sSt(s=>s+1),1000);return()=>clearInterval(i)},[conn]);

  const localToPhone=useCallback((clientX:number,clientY:number)=>{
    const el=overlayRef.current;
    if(!el) return null;
    const r=el.getBoundingClientRect();
    const nx=Math.min(1,Math.max(0,(clientX-r.left)/r.width));
    const ny=Math.min(1,Math.max(0,(clientY-r.top)/r.height));
    return { x: Math.round(nx*phoneW), y: Math.round(ny*phoneH) };
  },[phoneW,phoneH]);

  // Mouse-down position + timestamp; consulted on mouse-up to decide whether
  // the gesture was a tap (small displacement) or a swipe (drag). Refs avoid
  // re-renders on every mouse event.
  const dragRef=useRef<{x:number;y:number;t:number}|null>(null);

  const onMouseDown=useCallback((e:React.MouseEvent)=>{
    if(conn||e.button!==0) return;
    const p=localToPhone(e.clientX,e.clientY);
    if(!p) return;
    dragRef.current={x:p.x,y:p.y,t:performance.now()};
  },[conn,localToPhone]);

  const onMouseUp=useCallback((e:React.MouseEvent)=>{
    if(conn||e.button!==0) return;
    const start=dragRef.current;
    dragRef.current=null;
    if(!start) return;
    const end=localToPhone(e.clientX,e.clientY);
    if(!end) return;
    const dist=Math.hypot(end.x-start.x,end.y-start.y);
    // Threshold roughly matches Android's tap slop. Below it = tap; above = swipe.
    if(dist<24){
      sendInput(device.id,{type:"tap",x:end.x,y:end.y})?.catch(()=>{});
      addLog("TAP",`(${end.x}, ${end.y})`);
    }else{
      const dur=Math.round(Math.min(800,Math.max(120,performance.now()-start.t)));
      sendInput(device.id,{type:"swipe",startX:start.x,startY:start.y,endX:end.x,endY:end.y,durationMs:dur})?.catch(()=>{});
      addLog("SWIPE",`${Math.round(dist)}px ${dur}ms`);
    }
  },[addLog,conn,device.id,localToPhone]);

  const onScroll=useCallback((e:React.WheelEvent)=>{
    if(conn) return;
    e.preventDefault();
    const p=localToPhone(e.clientX,e.clientY);
    if(!p) return;
    sendInput(device.id,{type:"scroll",x:p.x,y:p.y,deltaY:e.deltaY})?.catch(()=>{});
    addLog("SCROLL",e.deltaY>0?"DOWN":"UP");
  },[addLog,conn,device.id,localToPhone]);

  const sendKey=useCallback((keyCode:string,label:string)=>{
    sendInput(device.id,{type:"key",keyCode})?.catch(()=>{});
    addLog("KEY",label);
  },[addLog,device.id]);

  const handleDisconnect=async()=>{try{await stopWatching(device.id)}catch{/* ignore */}onBack()};

  const S=({d:path,sz=14}:any)=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={path}/></svg>;
  const PS=({title,children}:any)=><div style={{display:"flex",flexDirection:"column",gap:2}}><span style={{fontSize:8,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:3,fontWeight:600}}>{title}</span>{children}</div>;

  return<div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--b0)",animation:"fi .2s"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:"1px solid var(--br)",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={handleDisconnect} style={{all:"unset",cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:"var(--f2)",fontSize:11,fontWeight:500}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color="var(--f)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color="var(--f2)"}><S d="M19 12H5M12 19l-7-7 7-7"/>Back</button>
        <span style={{color:"var(--br)"}}>|</span><Dot s={device.status}/>
        <span style={{fontSize:13,fontWeight:600,color:"var(--f)"}}>{device.name}</span>
        {!conn&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:3,background:"var(--blued)",color:"var(--blue)",fontFamily:"var(--m)",fontWeight:600}}>{Math.floor(st/60)}:{(st%60).toString().padStart(2,"0")}</span>}
      </div>
    </div>
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:16,gap:16,minHeight:0}}>
      <div style={{position:"relative",borderRadius:22,border:"3px solid var(--brh)",overflow:"hidden",boxShadow:"0 8px 36px rgba(0,0,0,.4)",height:"min(100%,580px)",aspectRatio:"9/19.5",background:"#000",flexShrink:0}}>
        <div style={{width:"100%",height:"100%",position:"relative"}}>
          <video ref={videoRef} autoPlay playsInline muted style={{width:"100%",height:"100%",objectFit:"contain",background:"#000",display:"block"}}/>
          <div ref={overlayRef} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onWheel={onScroll} style={{position:"absolute",inset:0,cursor:conn?"wait":"crosshair",zIndex:10}}/>
          {conn&&<div style={{position:"absolute",inset:0,background:"rgba(7,8,10,.85)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,zIndex:20}}><div style={{width:32,height:32,border:"3px solid var(--br)",borderTopColor:"var(--blue)",borderRadius:"50%",animation:"sp .7s linear infinite"}}/><div style={{fontSize:12,fontWeight:600,color:"var(--f)"}}>Connecting...</div><div style={{fontSize:10,color:"var(--f3)"}}>Establishing WebRTC session</div></div>}
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12,width:180,flexShrink:0}}>
        <PS title="Navigation"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}><Ctrl label="Back" onClick={()=>sendKey("KEYCODE_BACK","BACK")}><S d="M19 12H5M12 19l-7-7 7-7"/></Ctrl><Ctrl label="Home" onClick={()=>sendKey("KEYCODE_HOME","HOME")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/></svg></Ctrl><Ctrl label="Recents" onClick={()=>sendKey("KEYCODE_APP_SWITCH","RECENTS")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></Ctrl></div></PS>
        <PS title="System"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}><Ctrl label="Vol−" onClick={()=>sendKey("KEYCODE_VOLUME_DOWN","V-")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg></Ctrl><Ctrl label="Vol+" onClick={()=>sendKey("KEYCODE_VOLUME_UP","V+")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg></Ctrl><Ctrl label="Lock" onClick={()=>sendKey("KEYCODE_POWER","LOCK")} danger><S d="M5 11a2 2 0 012-2h10a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2v-9zM8 11V7a4 4 0 118 0v4"/></Ctrl></div></PS>
        <Ctrl label="Disconnect" onClick={handleDisconnect} danger><S d="M18.36 6.64A9 9 0 0120.77 15M2 12C2 6.48 6.48 2 12 2M15 2a10 10 0 014.65 3.5M1 1l22 22"/></Ctrl>
        <PS title="Input Log"><div style={{background:"var(--b2)",borderRadius:5,padding:6,fontFamily:"var(--m)",fontSize:8,color:"var(--f3)",minHeight:60,display:"flex",flexDirection:"column",gap:2}}>{log.length===0?<span style={{opacity:.4}}>Interact with screen...</span>:log.map((l,i)=><div key={i} style={{display:"flex",gap:4}}><span style={{color:"var(--blue)",fontWeight:600}}>{l.t}</span><span>{l.d}</span></div>)}</div></PS>
      </div>
    </div>
  </div>
};

// ─────────────────────────────────────────────────────
// MANAGE USERS
// ─────────────────────────────────────────────────────
const INPUT_STYLE:React.CSSProperties={width:"100%",padding:"8px 11px",borderRadius:6,background:"var(--b2)",border:"1px solid var(--br)",color:"var(--f)",fontSize:12,fontFamily:"var(--s)",outline:"none",boxSizing:"border-box",transition:"border .15s"};

const Field=({label,children}:{label:string;children:React.ReactNode})=><label style={{display:"flex",flexDirection:"column",gap:4}}><span style={{fontSize:10,fontWeight:600,color:"var(--f2)"}}>{label}</span>{children}</label>;

const Input=(p:React.InputHTMLAttributes<HTMLInputElement>)=><input {...p} style={{...INPUT_STYLE,...(p.style??{})}} onFocus={e=>{(e.target as HTMLInputElement).style.borderColor="var(--blue)";p.onFocus?.(e)}} onBlur={e=>{(e.target as HTMLInputElement).style.borderColor="var(--br)";p.onBlur?.(e)}}/>;

type FormState={username:string;displayName:string;email:string;role:Role;password:string};
const EMPTY_FORM:FormState={username:"",displayName:"",email:"",role:"user",password:""};

const UserFormModal=({mode,initial,onClose,onSave,saving,error}:{mode:"create"|"edit";initial:FormState;onClose:()=>void;onSave:(f:FormState)=>void;saving:boolean;error:string})=>{
  const[f,sF]=useState<FormState>(initial);
  useEffect(()=>{sF(initial)},[initial]);
  const up=(k:keyof FormState)=>(e:React.ChangeEvent<HTMLInputElement>)=>sF(p=>({...p,[k]:e.target.value}));
  const canSave=f.displayName.trim().length>0&&(mode==="edit"||(f.username.trim().length>0&&f.password.length>=4));
  return<div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(7,8,10,.65)",backdropFilter:"blur(2px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:150,animation:"fi .15s"}}>
    <div onClick={e=>e.stopPropagation()} style={{width:420,maxWidth:"calc(100vw - 48px)",background:"var(--b1)",borderRadius:10,border:"1px solid var(--br)",boxShadow:"0 18px 48px rgba(0,0,0,.5)",animation:"fu .2s"}}>
      <div style={{padding:"14px 18px",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <h3 style={{fontSize:13,fontWeight:700,color:"var(--f)"}}>{mode==="create"?"New User":"Edit User"}</h3>
        <button onClick={onClose} style={{all:"unset",cursor:"pointer",color:"var(--f3)",padding:4}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color="var(--f)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color="var(--f3)"}><Ico d="M18 6L6 18M6 6l12 12"/></button>
      </div>
      <div style={{padding:18,display:"flex",flexDirection:"column",gap:12}}>
        <Field label="Display Name"><Input value={f.displayName} onChange={up("displayName")} placeholder="Jordan Lee"/></Field>
        {mode==="create"&&<Field label="Username"><Input value={f.username} onChange={up("username")} placeholder="jordan" autoComplete="off"/></Field>}
        <Field label="Email"><Input type="email" value={f.email} onChange={up("email")} placeholder="optional"/></Field>
        <Field label="Role">
          <div style={{display:"flex",gap:6}}>{(["admin","user"] as Role[]).map(r=><button key={r} onClick={()=>sF(p=>({...p,role:r}))} style={{all:"unset",boxSizing:"border-box",flex:1,cursor:"pointer",padding:"8px 10px",borderRadius:6,textAlign:"center",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",border:`1px solid ${f.role===r?"var(--blue)":"var(--br)"}`,background:f.role===r?"var(--blued)":"var(--b2)",color:f.role===r?"var(--blue)":"var(--f2)",transition:"all .12s"}}>{r}</button>)}</div>
        </Field>
        {mode==="create"&&<Field label="Password"><Input type="password" value={f.password} onChange={up("password")} placeholder="min 4 characters" autoComplete="new-password"/></Field>}
        {error&&<div style={{padding:"6px 10px",borderRadius:5,background:"rgba(232,69,69,.08)",border:"1px solid rgba(232,69,69,.2)",color:"var(--red)",fontSize:11}}>{error}</div>}
      </div>
      <div style={{padding:"12px 18px",borderTop:"1px solid var(--br)",display:"flex",justifyContent:"flex-end",gap:8}}>
        <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>canSave&&onSave(f)} disabled={!canSave||saving}>{saving?"Saving…":mode==="create"?"Create":"Save"}</Btn>
      </div>
    </div>
  </div>
};

const PasswordResetModal=({user,onClose,onSave,saving,error}:{user:AuthUser;onClose:()=>void;onSave:(pw:string)=>void;saving:boolean;error:string})=>{
  const[pw,sPw]=useState("");
  const canSave=pw.length>=4;
  return<div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(7,8,10,.65)",backdropFilter:"blur(2px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:150,animation:"fi .15s"}}>
    <div onClick={e=>e.stopPropagation()} style={{width:380,maxWidth:"calc(100vw - 48px)",background:"var(--b1)",borderRadius:10,border:"1px solid var(--br)",boxShadow:"0 18px 48px rgba(0,0,0,.5)",animation:"fu .2s"}}>
      <div style={{padding:"14px 18px",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <h3 style={{fontSize:13,fontWeight:700,color:"var(--f)"}}>Reset Password</h3>
        <button onClick={onClose} style={{all:"unset",cursor:"pointer",color:"var(--f3)",padding:4}}><Ico d="M18 6L6 18M6 6l12 12"/></button>
      </div>
      <div style={{padding:18,display:"flex",flexDirection:"column",gap:12}}>
        <div style={{fontSize:11,color:"var(--f3)"}}>Set a new password for <span style={{color:"var(--f)",fontWeight:600}}>{user.displayName}</span> <span style={{fontFamily:"var(--m)"}}>({user.username})</span>.</div>
        <Field label="New Password"><Input type="password" value={pw} onChange={e=>sPw(e.target.value)} placeholder="min 4 characters" autoComplete="new-password"/></Field>
        {error&&<div style={{padding:"6px 10px",borderRadius:5,background:"rgba(232,69,69,.08)",border:"1px solid rgba(232,69,69,.2)",color:"var(--red)",fontSize:11}}>{error}</div>}
      </div>
      <div style={{padding:"12px 18px",borderTop:"1px solid var(--br)",display:"flex",justifyContent:"flex-end",gap:8}}>
        <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>canSave&&onSave(pw)} disabled={!canSave||saving}>{saving?"Saving…":"Reset"}</Btn>
      </div>
    </div>
  </div>
};

const ConfirmModal=({title,body,confirmLabel,onCancel,onConfirm,busy}:{title:string;body:React.ReactNode;confirmLabel:string;onCancel:()=>void;onConfirm:()=>void;busy:boolean})=>
  <div onClick={onCancel} style={{position:"fixed",inset:0,background:"rgba(7,8,10,.65)",backdropFilter:"blur(2px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:150,animation:"fi .15s"}}>
    <div onClick={e=>e.stopPropagation()} style={{width:360,maxWidth:"calc(100vw - 48px)",background:"var(--b1)",borderRadius:10,border:"1px solid var(--br)",boxShadow:"0 18px 48px rgba(0,0,0,.5)",animation:"fu .2s"}}>
      <div style={{padding:"14px 18px",borderBottom:"1px solid var(--br)"}}><h3 style={{fontSize:13,fontWeight:700,color:"var(--f)"}}>{title}</h3></div>
      <div style={{padding:18,fontSize:12,color:"var(--f2)",lineHeight:1.5}}>{body}</div>
      <div style={{padding:"12px 18px",borderTop:"1px solid var(--br)",display:"flex",justifyContent:"flex-end",gap:8}}>
        <Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn variant="danger" onClick={onConfirm} disabled={busy}>{busy?"…":confirmLabel}</Btn>
      </div>
    </div>
  </div>;

type Modal =
  | { kind: "create" }
  | { kind: "edit"; user: AuthUser }
  | { kind: "password"; user: AuthUser }
  | { kind: "delete"; user: AuthUser }
  | null;

const ManageUsers=({currentUser,onBack}:{currentUser:AuthUser;onBack:()=>void})=>{
  const[list,sList]=useState<AuthUser[]>([]);
  const[loading,sLoading]=useState(true);
  const[modal,sModal]=useState<Modal>(null);
  const[modalErr,sModalErr]=useState("");
  const[busy,sBusy]=useState(false);
  const[banner,sBanner]=useState("");

  const load=useCallback(async()=>{
    sLoading(true);
    try{const u=await api.listUsers();sList(u)}
    catch(e:any){sBanner(e?.message??"Failed to load users")}
    finally{sLoading(false)}
  },[]);
  useEffect(()=>{load()},[load]);

  const closeModal=()=>{sModal(null);sModalErr("")};
  const errFrom=(e:any)=>e instanceof ApiError?(e.detail?.error?`${e.detail.error}`:e.message):(e?.message??"Request failed");

  const handleCreate=async(f:FormState)=>{
    sBusy(true);sModalErr("");
    try{
      await api.createUser({username:f.username.trim(),password:f.password,displayName:f.displayName.trim(),email:f.email.trim()||null,role:f.role});
      closeModal();await load();
    }catch(e){sModalErr(errFrom(e))}finally{sBusy(false)}
  };
  const handleEdit=async(f:FormState,id:string)=>{
    sBusy(true);sModalErr("");
    try{
      await api.updateUser(id,{displayName:f.displayName.trim(),email:f.email.trim()||null,role:f.role});
      closeModal();await load();
    }catch(e){sModalErr(errFrom(e))}finally{sBusy(false)}
  };
  const handlePassword=async(pw:string,id:string)=>{
    sBusy(true);sModalErr("");
    try{await api.resetPassword(id,pw);closeModal();sBanner("Password updated")}
    catch(e){sModalErr(errFrom(e))}finally{sBusy(false)}
  };
  const handleDelete=async(id:string)=>{
    sBusy(true);sModalErr("");
    try{await api.deleteUser(id);closeModal();await load()}
    catch(e){sModalErr(errFrom(e));sBusy(false)}
    finally{sBusy(false)}
  };

  const RowBtn=({icon,label,onClick,danger}:{icon:string;label:string;onClick:()=>void;danger?:boolean})=><button onClick={onClick} title={label} style={{all:"unset",boxSizing:"border-box",cursor:"pointer",padding:6,borderRadius:5,color:danger?"var(--red)":"var(--f2)",transition:"background .12s",display:"inline-flex",alignItems:"center",justifyContent:"center"}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=danger?"rgba(232,69,69,.1)":"var(--b2)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background="transparent"}><Ico d={icon} sz={13}/></button>;

  return<div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--b0)",animation:"fu .25s"}}>
    <div style={{padding:"12px 20px",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
      <button onClick={onBack} style={{all:"unset",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:"var(--f2)",fontSize:11,fontWeight:500}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color="var(--f)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color="var(--f2)"}><Ico d="M19 12H5M12 19l-7-7 7-7"/>Dashboard</button>
      <span style={{color:"var(--br)"}}>|</span>
      <span style={{fontSize:14,fontWeight:700,color:"var(--f)"}}>Manage Users</span>
      <span style={{fontSize:11,color:"var(--f3)"}}>{list.length} {list.length===1?"user":"users"}</span>
      <div style={{flex:1}}/>
      <Btn variant="primary" onClick={()=>{sModalErr("");sModal({kind:"create"})}}>+ Add User</Btn>
    </div>

    {banner&&<div onClick={()=>sBanner("")} style={{margin:"12px 24px 0",padding:"8px 12px",borderRadius:6,background:"var(--b2)",border:"1px solid var(--br)",color:"var(--f2)",fontSize:11,cursor:"pointer"}}>{banner}<span style={{opacity:.4,marginLeft:8}}>×</span></div>}

    <div style={{flex:1,overflow:"auto",padding:24}}>
      <div style={{background:"var(--b1)",borderRadius:9,border:"1px solid var(--br)",overflow:"hidden"}}>
        {loading?<div style={{padding:24,color:"var(--f3)",fontSize:12,textAlign:"center"}}>Loading…</div>:list.length===0?<div style={{padding:24,color:"var(--f3)",fontSize:12,textAlign:"center"}}>No users</div>:
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid var(--br)",background:"var(--b2)"}}>
            {["Name","Username","Email","Role","Actions"].map((h,i)=><th key={h} style={{textAlign:i===4?"right":"left",padding:"10px 14px",fontSize:9,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em"}}>{h}</th>)}
          </tr></thead>
          <tbody>{list.map(u=>{const isSelf=u.id===currentUser.id;const ini=u.displayName.split(" ").map(n=>n[0]).join("").slice(0,2);const adm=u.role==="admin";return<tr key={u.id} style={{borderBottom:"1px solid var(--br)"}}>
            <td style={{padding:"10px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:26,height:26,borderRadius:5,background:adm?"var(--blued)":"var(--b2)",border:`1px solid ${adm?"rgba(76,141,245,.22)":"var(--br)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:adm?"var(--blue)":"var(--f3)"}}>{ini}</div>
                <div><div style={{color:"var(--f)",fontWeight:500}}>{u.displayName}</div>{isSelf&&<div style={{fontSize:9,color:"var(--f3)"}}>you</div>}</div>
              </div>
            </td>
            <td style={{padding:"10px 14px",color:"var(--f2)",fontFamily:"var(--m)",fontSize:11}}>{u.username}</td>
            <td style={{padding:"10px 14px",color:"var(--f3)",fontSize:11}}>{u.email||<span style={{opacity:.5}}>—</span>}</td>
            <td style={{padding:"10px 14px"}}><RB r={u.role}/></td>
            <td style={{padding:"10px 14px",textAlign:"right"}}>
              <div style={{display:"inline-flex",gap:2}}>
                <RowBtn icon="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" label="Edit" onClick={()=>{sModalErr("");sModal({kind:"edit",user:u})}}/>
                <RowBtn icon="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" label="Reset password" onClick={()=>{sModalErr("");sModal({kind:"password",user:u})}}/>
                <RowBtn icon="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" label={isSelf?"Cannot delete yourself":"Delete"} onClick={()=>{if(isSelf){sBanner("You can't delete yourself");return}sModalErr("");sModal({kind:"delete",user:u})}} danger/>
              </div>
            </td>
          </tr>})}</tbody>
        </table>}
      </div>
    </div>

    {modal?.kind==="create"&&<UserFormModal mode="create" initial={EMPTY_FORM} onClose={closeModal} onSave={handleCreate} saving={busy} error={modalErr}/>}
    {modal?.kind==="edit"&&<UserFormModal mode="edit" initial={{username:modal.user.username,displayName:modal.user.displayName,email:modal.user.email??"",role:modal.user.role,password:""}} onClose={closeModal} onSave={f=>handleEdit(f,modal.user.id)} saving={busy} error={modalErr}/>}
    {modal?.kind==="password"&&<PasswordResetModal user={modal.user} onClose={closeModal} onSave={pw=>handlePassword(pw,modal.user.id)} saving={busy} error={modalErr}/>}
    {modal?.kind==="delete"&&<ConfirmModal title="Delete User" body={<>Delete <span style={{color:"var(--f)",fontWeight:600}}>{modal.user.displayName}</span> <span style={{fontFamily:"var(--m)"}}>({modal.user.username})</span>? This cannot be undone.{modalErr&&<div style={{marginTop:10,padding:"6px 10px",borderRadius:5,background:"rgba(232,69,69,.08)",border:"1px solid rgba(232,69,69,.2)",color:"var(--red)",fontSize:11}}>{modalErr}</div>}</>} confirmLabel="Delete" onCancel={closeModal} onConfirm={()=>handleDelete(modal.user.id)} busy={busy}/>}
  </div>
};

// ─────────────────────────────────────────────────────
// PAIR DEVICE
// ─────────────────────────────────────────────────────
const PairDevice=({onBack,pairedToken,pairedDevice}:{onBack:()=>void;pairedToken:string|null;pairedDevice:Device|null})=>{
  const[pt,sPt]=useState<PairingToken|null>(null);
  const[issuing,sIssuing]=useState(true);
  const[issueErr,sIssueErr]=useState("");
  const[remaining,sRemaining]=useState(0);
  const tokenRef=useRef<string|null>(null);

  const issue=useCallback(async()=>{
    sIssuing(true);sIssueErr("");
    try{
      const r=await api.startPair();
      sPt(r);tokenRef.current=r.token;sRemaining(r.expiresInSeconds);
    }catch(e){
      const msg=e instanceof ApiError&&e.detail?.error==="max_devices_reached"?"Device limit reached (max 10)":(e as any)?.message??"Failed to generate token";
      sIssueErr(msg);
    }finally{sIssuing(false)}
  },[]);

  useEffect(()=>{issue();return()=>{const t=tokenRef.current;if(t)api.cancelPair(t).catch(()=>{})}},[issue]);

  useEffect(()=>{
    if(!pt)return;
    const tick=()=>sRemaining(Math.max(0,Math.ceil((pt.expiresAt-Date.now())/1000)));
    tick();
    const i=setInterval(tick,1000);
    return()=>clearInterval(i);
  },[pt]);

  // Stop the cancel-on-unmount cleanup once the agent has consumed the token —
  // otherwise navigating away after a successful pair would issue a useless
  // DELETE for an already-consumed token.
  useEffect(()=>{
    if(pt&&pairedToken===pt.token){tokenRef.current=null}
  },[pt,pairedToken,pairedDevice]);

  const expired=pt!==null&&remaining<=0;
  const completed=!!(pt&&pairedToken===pt.token&&pairedDevice);
  const mm=Math.floor(remaining/60),ss=remaining%60;

  return<div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--b0)",animation:"fu .25s"}}>
    <div style={{padding:"12px 20px",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
      <button onClick={onBack} style={{all:"unset",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:"var(--f2)",fontSize:11,fontWeight:500}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color="var(--f)"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color="var(--f2)"}><Ico d="M19 12H5M12 19l-7-7 7-7"/>Dashboard</button>
      <span style={{color:"var(--br)"}}>|</span>
      <span style={{fontSize:14,fontWeight:700,color:"var(--f)"}}>Pair New Device</span>
    </div>

    <div style={{flex:1,overflow:"auto",padding:24,display:"flex",justifyContent:"center",alignItems:"flex-start"}}>
      <div style={{background:"var(--b1)",borderRadius:9,border:`1px solid ${expired?"rgba(232,69,69,.25)":completed?"rgba(45,212,160,.25)":"var(--br)"}`,padding:24,display:"flex",flexDirection:"column",gap:18,maxWidth:420,width:"100%",alignItems:"center"}}>
        <div style={{textAlign:"center"}}>
          <h3 style={{fontSize:11,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Pair via QR code</h3>
          <div style={{fontSize:11,color:"var(--f2)",lineHeight:1.5,maxWidth:320}}>Open the RDP Agent app on the Android device and scan the QR code below.</div>
        </div>

        <div style={{padding:14,borderRadius:8,background:"#fff",border:`1px solid ${expired?"rgba(232,69,69,.25)":"var(--br)"}`,minHeight:248,minWidth:248,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {issuing?<div style={{fontSize:13,color:"#444"}}>Generating…</div>:
           issueErr?<div style={{fontSize:11,color:"var(--red)",padding:20}}>{issueErr}</div>:
           completed?<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,color:"var(--grn)"}}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg><div style={{fontSize:12,color:"#222",fontWeight:600}}>Paired</div></div>:
           pt&&!expired?<QRCodeSVG value={pt.uri} size={220} level="M" includeMargin={false}/>:
           pt?<div style={{fontSize:12,color:"#888"}}>Token expired</div>:null}
        </div>

        {pt&&!issueErr&&!completed&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:10,color:"var(--f3)",width:"100%",maxWidth:248}}>
          {expired?<span style={{color:"var(--red)"}}>Expired</span>:<><span>Expires in</span><span style={{fontFamily:"var(--m)",color:remaining<60?"var(--amb)":"var(--f2)",fontWeight:600}}>{mm}:{ss.toString().padStart(2,"0")}</span></>}
        </div>}

        {pt&&!expired&&!issueErr&&!completed&&<div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:6,background:"rgba(76,141,245,.06)",border:"1px solid rgba(76,141,245,.15)",fontSize:10,color:"var(--blue)"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"var(--blue)",animation:"pr 2s infinite",flexShrink:0}}/>
          Waiting for device…
        </div>}

        {completed&&pairedDevice&&<div style={{fontSize:11,color:"var(--f2)",textAlign:"center"}}>{pairedDevice.name} joined the dashboard.</div>}

        {!issuing&&(expired||issueErr)&&<Btn variant="ghost" onClick={issue} full>Generate new code</Btn>}

        {pt&&!completed&&<div style={{fontFamily:"var(--m)",fontSize:9,color:"var(--f3)",wordBreak:"break-all",textAlign:"center",padding:"6px 10px",background:"var(--b2)",borderRadius:5,width:"100%"}}>{pt.uri}</div>}
      </div>
    </div>
  </div>
};

// ─────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────
type View = "dash" | "detail" | "remote" | "users" | "pair";

export default function App(){
  const[user,sUser]=useState<AuthUser|null>(null);
  const[view,sView]=useState<View>("dash");
  const[selId,setSelId]=useState<string|null>(null);
  const[devices,sDevices]=useState<Device[]>([]);
  const[err,sErr]=useState<string>("");
  const[pairedToken,sPairedToken]=useState<string|null>(null);
  const[pairedDevice,sPairedDevice]=useState<Device|null>(null);
  // ICE servers come back from WatchDevice (SignalR) and are handed to the
  // RTCPeerConnection inside RemoteView. Empty list when LAN-only.
  const[iceServers,sIceServers]=useState<RTCIceServer[]>([]);

  const sel=selId?devices.find(d=>d.id===selId)??null:null;

  // After login: fetch devices + connect SignalR
  useEffect(()=>{
    if(!user)return;
    let cancelled=false;
    api.devices().then(d=>{if(!cancelled)sDevices(d)}).catch(e=>sErr(e?.message??"Failed to load devices"));
    connectHub(
      next=>{if(!cancelled)sDevices(next)},
      (deviceId,reason)=>{
        if(cancelled)return;
        if(reason==="admin"){
          sErr("Your session was ended by an admin.");
          sView("detail");
          setSelId(deviceId);
        }else if(reason==="revoked"){
          sErr("Your session was ended — device trust revoked.");
          sView("dash");
        }
      },
      (token,device)=>{
        if(cancelled)return;
        sPairedToken(token);
        sPairedDevice(device);
      }
    ).catch(e=>sErr(`Realtime channel error: ${e?.message??e}`));
    return()=>{cancelled=true;disconnectHub()};
  },[user]);

  // Auto-advance to the new device's detail view ~1.2s after the agent confirms
  // pairing — long enough for the admin to register the success state on the
  // QR card before transitioning.
  useEffect(()=>{
    if(view!=="pair"||!pairedDevice)return;
    const t=setTimeout(()=>{
      setSelId(pairedDevice.id);
      sView("detail");
      sPairedToken(null);
      sPairedDevice(null);
    },1200);
    return()=>clearTimeout(t);
  },[view,pairedDevice]);

  const openDetail=(d:Device)=>{setSelId(d.id);sView("detail")};
  const connect=async(d:Device)=>{
    try{
      const res=await watchDevice(d.id);
      if(res&&res.error){
        sErr(res.error==="device_in_use"?`In use by ${res.connectedUser}`:res.error);
        return;
      }
      sIceServers(res?.iceServers??[]);
      setSelId(d.id);
      sView("remote");
    }catch(e:any){sErr(e?.message??"Failed to connect")}
  };
  const backToDetail=()=>sView("detail");
  const logout=()=>{disconnectHub();setToken(null);sUser(null);sView("dash");setSelId(null);sDevices([])};

  const isAdmin=user?.role==="admin";
  const onC=devices.filter(d=>d.status==="online").length;
  const idC=devices.filter(d=>d.status==="idle").length;

  return<div style={{width:"100%",height:"100vh",background:"var(--b0)",color:"var(--f)",fontFamily:"var(--s)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <style>{CSS}</style>
    {err&&<div style={{position:"fixed",top:12,right:12,zIndex:200,background:"rgba(232,69,69,.12)",border:"1px solid rgba(232,69,69,.3)",color:"var(--red)",padding:"8px 14px",borderRadius:6,fontSize:12,animation:"fu .2s"}} onClick={()=>sErr("")}>{err} <span style={{opacity:.5,marginLeft:8,cursor:"pointer"}}>×</span></div>}
    {!user?<Login onLogin={(u,t)=>{setToken(t);sUser(u)}}/>:view==="dash"?(
      <div style={{display:"flex",flexDirection:"column",height:"100%",animation:"fu .3s"}}>
        <div style={{padding:"12px 22px",borderBottom:"1px solid var(--br)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:28,height:28,borderRadius:6,background:"var(--blued)",display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div><div><h1 style={{fontSize:14,fontWeight:700,color:"var(--f)",lineHeight:1.2}}>Remote Desktop</h1><span style={{fontSize:9,color:"var(--f3)"}}>{devices.length} devices</span></div></div>
          <div style={{display:"flex",gap:16,alignItems:"center"}}><div style={{display:"flex",gap:12,fontSize:10}}><span style={{color:"var(--grn)"}}>{onC} online</span><span style={{color:"var(--amb)"}}>{idC} idle</span><span style={{color:"var(--f3)"}}>{devices.length-onC-idC} offline</span></div>{isAdmin&&<Btn variant="ghost" onClick={()=>sView("pair")}>+ Pair Device</Btn>}<UserMenu user={user} onLogout={logout} onOpenUsers={()=>sView("users")}/></div>
        </div>
        <div style={{flex:1,overflow:"auto",padding:22}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(205px,245px))",gap:11,maxWidth:1400}}>
            {devices.map((d,i)=><div key={d.id} style={{animation:`fu .3s ease ${i*.04}s both`}}><DeviceCard d={d} onClick={openDetail}/></div>)}
            {isAdmin&&devices.length<10&&<button onClick={()=>sView("pair")} style={{all:"unset",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",border:"2px dashed var(--br)",borderRadius:9,height:164,color:"var(--f3)",fontSize:10,gap:6,transition:"all .2s"}} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor="var(--blue)";(e.currentTarget as HTMLElement).style.color="var(--blue)"}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor="var(--br)";(e.currentTarget as HTMLElement).style.color="var(--f3)"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg>Pair new device</button>}
          </div>
        </div>
        <div style={{padding:"7px 22px",borderTop:"1px solid var(--br)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:9,color:"var(--f3)",flexShrink:0}}><span>SignalR · WebRTC · PostgreSQL</span><div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{width:5,height:5,borderRadius:"50%",background:"var(--grn)"}}/>Server connected</div></div>
      </div>
    ):view==="users"&&isAdmin?(
      <ManageUsers currentUser={user} onBack={()=>sView("dash")}/>
    ):view==="pair"&&isAdmin?(
      <PairDevice onBack={()=>{sPairedToken(null);sPairedDevice(null);sView("dash")}} pairedToken={pairedToken} pairedDevice={pairedDevice}/>
    ):view==="detail"&&sel?(
      <DeviceDetail device={sel} user={user} onBack={()=>sView("dash")} onConnect={connect}/>
    ):view==="remote"&&sel?(
      <RemoteView device={sel} iceServers={iceServers} onBack={backToDetail}/>
    ):<div style={{padding:24,color:"var(--f3)"}}>Not found. <button onClick={()=>sView("dash")} style={{color:"var(--blue)",background:"none",border:"none",cursor:"pointer"}}>Back to dashboard</button></div>}
  </div>
}
