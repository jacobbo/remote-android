import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════
const USERS = [
  { id:"u1", username:"admin", password:"admin", displayName:"Alex Morgan", role:"admin", email:"alex@co.dev" },
  { id:"u2", username:"user1", password:"user1", displayName:"Jordan Lee", role:"user", email:"jordan@co.dev" },
  { id:"u3", username:"user2", password:"user2", displayName:"Sam Chen", role:"user", email:"sam@co.dev" },
];
const DEVICES = [
  { id:"d1", name:"Pixel 8 Pro", model:"Google Pixel 8 Pro", status:"online", battery:87, signal:4, resolution:"1080x2400", orientation:"portrait", os:"Android 14", ip:"192.168.1.41", lastSeen:Date.now(), fps:28, bitrate:2400, latency:12, dropped:3 },
  { id:"d2", name:"Galaxy S24", model:"Samsung Galaxy S24", status:"online", battery:54, signal:3, resolution:"1080x2340", orientation:"portrait", os:"Android 14", ip:"192.168.1.42", lastSeen:Date.now(), fps:30, bitrate:3100, latency:8, dropped:0, connectedUser:{ id:"u2", displayName:"Jordan Lee", since:Date.now()-332000 } },
  { id:"d3", name:"OnePlus 12", model:"OnePlus 12", status:"online", battery:23, signal:5, resolution:"1440x3168", orientation:"portrait", os:"Android 14", ip:"192.168.1.43", lastSeen:Date.now(), fps:25, bitrate:1800, latency:22, dropped:12 },
  { id:"d4", name:"Pixel Fold", model:"Google Pixel Fold", status:"idle", battery:95, signal:4, resolution:"1840x2208", orientation:"landscape", os:"Android 14", ip:"192.168.1.44", lastSeen:Date.now()-120000 },
  { id:"d5", name:"Galaxy A54", model:"Samsung Galaxy A54", status:"offline", battery:12, signal:0, resolution:"1080x2340", orientation:"portrait", os:"Android 13", ip:"192.168.1.45", lastSeen:Date.now()-3600000 },
  { id:"d6", name:"Xiaomi 14", model:"Xiaomi 14", status:"online", battery:71, signal:3, resolution:"1200x2670", orientation:"portrait", os:"Android 14", ip:"192.168.1.46", lastSeen:Date.now(), fps:30, bitrate:2900, latency:15, dropped:1 },
  { id:"d7", name:"Nothing Phone 2", model:"Nothing Phone (2)", status:"online", battery:44, signal:2, resolution:"1080x2412", orientation:"portrait", os:"Android 14", ip:"192.168.1.47", lastSeen:Date.now(), fps:22, bitrate:1500, latency:35, dropped:8 },
];
const SESSIONS = [
  { user:"Jordan Lee", started:"2026-04-20 09:12", ended:"2026-04-20 09:18", duration:"5m 42s", reason:"user" },
  { user:"Alex Morgan", started:"2026-04-20 08:45", ended:"2026-04-20 08:52", duration:"6m 58s", reason:"user" },
  { user:"Sam Chen",   started:"2026-04-19 17:30", ended:"2026-04-19 17:31", duration:"1m 12s", reason:"network" },
  { user:"Jordan Lee", started:"2026-04-19 14:05", ended:"2026-04-19 14:22", duration:"17m 03s", reason:"user" },
  { user:"Alex Morgan", started:"2026-04-19 11:00", ended:"2026-04-19 11:08", duration:"8m 15s", reason:"admin" },
  { user:"Sam Chen",   started:"2026-04-18 16:44", ended:"2026-04-18 16:45", duration:"0m 48s", reason:"timeout" },
  { user:"Jordan Lee", started:"2026-04-18 10:20", ended:"2026-04-18 10:35", duration:"14m 55s", reason:"user" },
  { user:"Alex Morgan", started:"2026-04-17 15:30", ended:"2026-04-17 15:38", duration:"7m 33s", reason:"user" },
  { user:"Sam Chen",   started:"2026-04-17 09:10", ended:"2026-04-17 09:12", duration:"2m 01s", reason:"device_offline" },
  { user:"Jordan Lee", started:"2026-04-16 13:00", ended:"2026-04-16 13:20", duration:"20m 11s", reason:"user" },
];

// ═══════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════
// ATOMS
// ═══════════════════════════════════════════════════════
const Batt=({l})=>{const c=l<=20?"var(--red)":l<=50?"var(--amb)":"var(--grn)";return<svg width="18" height="10" viewBox="0 0 20 11"><rect x=".5" y=".5" width="15" height="10" rx="2" fill="none" stroke="var(--f3)" strokeWidth="1"/><rect x="16" y="3" width="3" height="5" rx="1" fill="var(--f3)"/><rect x="2" y="2" width={Math.max(0,l/100*11.5)} height="7" rx="1" fill={c}/></svg>};
const Sig=({l})=><svg width="13" height="11" viewBox="0 0 14 12">{[0,1,2,3,4].map(i=><rect key={i} x={i*2.8} y={12-(i+1)*2.4} width="2" height={(i+1)*2.4} rx=".4" fill={i<l?"var(--grn)":"var(--b3)"}/>)}</svg>;
const Dot=({s})=>{const c=s==="online"?"var(--grn)":s==="idle"?"var(--amb)":"var(--f3)";return<span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:7,height:7,borderRadius:"50%",background:c,boxShadow:s==="online"?`0 0 6px ${c}`:"none"}}/><span style={{fontSize:9,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".07em",fontWeight:600}}>{s}</span></span>};
const RB=({r})=>{const a=r==="admin";return<span style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",padding:"2px 6px",borderRadius:3,background:a?"var(--blued)":"rgba(78,85,102,.12)",color:a?"var(--blue)":"var(--f3)",border:`1px solid ${a?"rgba(76,141,245,.18)":"rgba(78,85,102,.18)"}`}}>{r}</span>};
const Ico=({d,sz=14})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;

const ago=ts=>{if(!ts)return"";const d=Date.now()-ts;if(d<60000)return"now";if(d<3600000)return Math.floor(d/60000)+"m ago";if(d<86400000)return Math.floor(d/3600000)+"h ago";return Math.floor(d/86400000)+"d ago"};
const fmtDur=ms=>{const s=Math.floor(ms/1000),m=Math.floor(s/60);return`${m}:${(s%60).toString().padStart(2,"0")}`};

const Btn=({children,onClick,variant="default",disabled,full})=>{
  const bg={default:"var(--b2)",primary:"var(--blue)",danger:"rgba(232,69,69,.12)",ghost:"transparent"}[variant];
  const fg={default:"var(--f2)",primary:"#fff",danger:"var(--red)",ghost:"var(--f2)"}[variant];
  const hv={default:"var(--bh)",primary:"rgba(76,141,245,.85)",danger:"rgba(232,69,69,.2)",ghost:"var(--b2)"}[variant];
  return<button onClick={disabled?undefined:onClick} style={{all:"unset",cursor:disabled?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px 16px",borderRadius:7,background:bg,color:fg,fontSize:12,fontWeight:600,fontFamily:"var(--s)",border:variant==="ghost"?"1px solid var(--br)":"none",transition:"all .15s",opacity:disabled?.4:1,width:full?"100%":undefined,textAlign:"center"}} onMouseEnter={e=>{if(!disabled)e.currentTarget.style.background=hv}} onMouseLeave={e=>{if(!disabled)e.currentTarget.style.background=bg}}>{children}</button>
};

// ═══════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════
const Login=({onLogin})=>{
  const[u,sU]=useState("");const[p,sP]=useState("");const[e,sE]=useState("");const[sk,sSk]=useState(false);
  const go=()=>{const f=USERS.find(x=>x.username===u&&x.password===p);if(f)onLogin(f);else{sE("Invalid credentials");sSk(true);setTimeout(()=>sSk(false),500)}};
  const I={width:"100%",padding:"9px 12px",borderRadius:6,background:"var(--b2)",border:"1px solid var(--br)",color:"var(--f)",fontSize:13,fontFamily:"var(--s)",outline:"none",transition:"border .15s"};
  return<div style={{width:"100%",height:"100vh",background:"var(--b0)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--s)"}}>
    <div style={{width:350,padding:32,background:"var(--b1)",borderRadius:12,border:"1px solid var(--br)",boxShadow:"0 20px 60px rgba(0,0,0,.5)",animation:sk?"sh .4s":"fu .5s"}}>
      <div style={{textAlign:"center",marginBottom:24}}><div style={{width:40,height:40,borderRadius:9,background:"var(--blued)",display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:8}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div><h1 style={{fontSize:17,fontWeight:700,color:"var(--f)"}}>Remote Desktop</h1><p style={{fontSize:11,color:"var(--f3)",marginTop:3}}>Sign in to continue</p></div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div><label style={{fontSize:10,fontWeight:600,color:"var(--f2)",display:"block",marginBottom:4}}>Username</label><input value={u} onChange={x=>{sU(x.target.value);sE("")}} style={I} onFocus={x=>x.target.style.borderColor="var(--blue)"} onBlur={x=>x.target.style.borderColor="var(--br)"}/></div>
        <div><label style={{fontSize:10,fontWeight:600,color:"var(--f2)",display:"block",marginBottom:4}}>Password</label><input type="password" value={p} onChange={x=>{sP(x.target.value);sE("")}} style={I} onFocus={x=>x.target.style.borderColor="var(--blue)"} onBlur={x=>x.target.style.borderColor="var(--br)"} onKeyDown={x=>x.key==="Enter"&&go()}/></div>
        {e&&<div style={{padding:"6px 10px",borderRadius:5,background:"rgba(232,69,69,.07)",border:"1px solid rgba(232,69,69,.13)",color:"var(--red)",fontSize:11}}>{e}</div>}
        <Btn variant="primary" onClick={go} full>Sign In</Btn>
      </div>
      <div style={{marginTop:18,padding:9,background:"var(--b2)",borderRadius:6,border:"1px solid var(--br)"}}>
        <span style={{fontSize:8,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",fontWeight:600}}>Demo Accounts</span>
        <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:5}}>{USERS.map(x=><button key={x.id} onClick={()=>{sU(x.username);sP(x.password);sE("")}} style={{all:"unset",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 6px",borderRadius:3,transition:"background .1s"}} onMouseEnter={e=>e.currentTarget.style.background="var(--bh)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}><span style={{fontSize:10,color:"var(--f2)",fontFamily:"var(--m)"}}>{x.username}/{x.password}</span><RB r={x.role}/></button>)}</div>
      </div>
    </div>
  </div>
};

// ═══════════════════════════════════════════════════════
// USER MENU
// ═══════════════════════════════════════════════════════
const UserMenu=({user,onLogout})=>{
  const[o,sO]=useState(false);const r=useRef(null);
  useEffect(()=>{const h=e=>{if(r.current&&!r.current.contains(e.target))sO(false)};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h)},[]);
  const ini=user.displayName.split(" ").map(n=>n[0]).join("");const adm=user.role==="admin";
  return<div ref={r} style={{position:"relative"}}>
    <button onClick={()=>sO(!o)} style={{all:"unset",cursor:"pointer",display:"flex",alignItems:"center",gap:6,padding:"3px 6px 3px 3px",borderRadius:6,transition:"background .15s"}} onMouseEnter={e=>e.currentTarget.style.background="var(--b2)"} onMouseLeave={e=>{if(!o)e.currentTarget.style.background="transparent"}}>
      <div style={{width:24,height:24,borderRadius:5,background:adm?"var(--blued)":"var(--b2)",border:`1px solid ${adm?"rgba(76,141,245,.22)":"var(--br)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:adm?"var(--blue)":"var(--f3)"}}>{ini}</div>
      <span style={{fontSize:11,color:"var(--f2)",fontWeight:500}}>{user.displayName}</span>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--f3)" strokeWidth="2.5" style={{transform:o?"rotate(180deg)":"none",transition:"transform .15s"}}><path d="M6 9l6 6 6-6"/></svg>
    </button>
    {o&&<div style={{position:"absolute",top:"calc(100% + 4px)",right:0,width:200,background:"var(--b1)",border:"1px solid var(--br)",borderRadius:8,boxShadow:"0 8px 28px rgba(0,0,0,.4)",overflow:"hidden",zIndex:100,animation:"fi .1s"}}>
      <div style={{padding:"10px 12px",borderBottom:"1px solid var(--br)"}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}><span style={{fontSize:11,fontWeight:600,color:"var(--f)"}}>{user.displayName}</span><RB r={user.role}/></div><span style={{fontSize:9,color:"var(--f3)"}}>{user.email}</span></div>
      <div style={{padding:4}}>
        {adm&&<MItem label="Manage Users"/>}{adm&&<MItem label="Settings"/>}
        <div style={{height:1,background:"var(--br)",margin:"3px 0"}}/>
        <button onClick={()=>{sO(false);onLogout()}} style={{all:"unset",cursor:"pointer",width:"100%",display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:4,fontSize:10,color:"var(--red)",transition:"background .1s"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(232,69,69,.07)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}><Ico d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" sz={12}/>Sign Out</button>
      </div>
    </div>}
  </div>
};
const MItem=({label})=><button style={{all:"unset",cursor:"pointer",width:"100%",display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:4,fontSize:10,color:"var(--f2)",transition:"background .1s"}} onMouseEnter={e=>e.currentTarget.style.background="var(--b2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{label}</button>;

// ═══════════════════════════════════════════════════════
// DEVICE CARD
// ═══════════════════════════════════════════════════════
const DeviceCard=({d,onClick})=>{
  const on=d.status==="online",off=d.status==="offline";
  const sc=on?"var(--grn)":d.status==="idle"?"var(--amb)":"var(--f3)";
  const cu=d.connectedUser;
  return<button onClick={()=>onClick(d)} style={{all:"unset",cursor:off?"default":"pointer",display:"flex",flexDirection:"column",height:cu?184:164,width:"100%",background:"var(--b1)",border:`1px solid ${cu?"rgba(76,141,245,.2)":"var(--br)"}`,borderRadius:9,overflow:"hidden",transition:"all .2s",boxShadow:cu?"0 0 0 1px rgba(76,141,245,.1),0 2px 12px rgba(0,0,0,.2)":"0 2px 8px rgba(0,0,0,.12)",opacity:off?.38:1}} onMouseEnter={e=>{if(!off)e.currentTarget.style.borderColor=cu?"rgba(76,141,245,.35)":"var(--f3)"}} onMouseLeave={e=>e.currentTarget.style.borderColor=cu?"rgba(76,141,245,.2)":"var(--br)"}>
    <div style={{padding:"14px 12px 10px",display:"flex",alignItems:"center",gap:9,borderBottom:"1px solid var(--br)"}}>
      <div style={{width:30,height:30,borderRadius:6,flexShrink:0,background:`${sc}12`,display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={sc} strokeWidth="1.8"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div>
      <div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"var(--f)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</div><div style={{fontSize:9,color:"var(--f3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.model}</div></div>
    </div>
    <div style={{padding:"8px 12px",display:"flex",flexDirection:"column",gap:6,flex:1}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><Dot s={d.status}/>{!on&&d.lastSeen&&<span style={{fontSize:8,color:"var(--f3)",fontFamily:"var(--m)"}}>{ago(d.lastSeen)}</span>}{on&&d.latency!=null&&<span style={{fontSize:8,color:d.latency>30?"var(--amb)":"var(--f3)",fontFamily:"var(--m)"}}>{d.latency}ms</span>}</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:4}}><Batt l={d.battery}/><span style={{fontSize:9,color:"var(--f3)"}}>{d.battery}%</span></div><Sig l={d.signal}/></div>
      <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:8,color:"var(--f3)"}}>{d.os}</span><span style={{fontSize:8,color:"var(--f3)",fontFamily:"var(--m)"}}>{d.ip}</span></div>
    </div>
    {cu&&<div style={{padding:"6px 12px",borderTop:"1px solid var(--br)",background:"rgba(76,141,245,.04)",display:"flex",alignItems:"center",gap:5}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:"var(--blue)",animation:"pr 2s infinite"}}/>
      <span style={{fontSize:9,color:"var(--blue)",fontWeight:500}}>{cu.displayName} connected</span>
    </div>}
  </button>
};

// ═══════════════════════════════════════════════════════
// DEVICE DETAIL VIEW
// ═══════════════════════════════════════════════════════
const DeviceDetail=({device,user,onBack,onConnect,devices,setDevices})=>{
  const cu=device.connectedUser;
  const isMeConnected=cu&&cu.id===user.id;
  const otherConnected=cu&&cu.id!==user.id;
  const canConnect=device.status==="online"&&!cu;
  const isAdmin=user.role==="admin";
  const[elapsed,setElapsed]=useState(cu?Date.now()-cu.since:0);
  useEffect(()=>{if(!cu)return;const i=setInterval(()=>setElapsed(Date.now()-cu.since),1000);return()=>clearInterval(i)},[cu]);

  const handleDisconnect=()=>{
    const updated=devices.map(dd=>dd.id===device.id?{...dd,connectedUser:undefined}:dd);
    setDevices(updated);
  };
  const handleForceDisconnect=()=>{
    const updated=devices.map(dd=>dd.id===device.id?{...dd,connectedUser:undefined}:dd);
    setDevices(updated);
  };

  const Info=({label,val})=><div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--br)"}}><span style={{fontSize:11,color:"var(--f3)"}}>{label}</span><span style={{fontSize:11,color:"var(--f)",fontFamily:"var(--m)"}}>{val}</span></div>;
  const reasonColor=r=>({user:"var(--grn)",admin:"var(--amb)",network:"var(--red)",timeout:"var(--f3)",device_offline:"var(--red)"}[r]||"var(--f3)");

  return<div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--b0)",animation:"fu .25s"}}>
    {/* Header */}
    <div style={{padding:"12px 20px",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
      <button onClick={onBack} style={{all:"unset",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:"var(--f2)",fontSize:11,fontWeight:500}} onMouseEnter={e=>e.currentTarget.style.color="var(--f)"} onMouseLeave={e=>e.currentTarget.style.color="var(--f2)"}><Ico d="M19 12H5M12 19l-7-7 7-7"/>Dashboard</button>
      <span style={{color:"var(--br)"}}>|</span>
      <Dot s={device.status}/>
      <span style={{fontSize:14,fontWeight:700,color:"var(--f)"}}>{device.name}</span>
      <span style={{fontSize:11,color:"var(--f3)"}}>{device.model}</span>
    </div>

    {/* Content */}
    <div style={{flex:1,overflow:"auto",padding:24,display:"flex",gap:20}}>
      {/* Left: info + actions */}
      <div style={{width:320,flexShrink:0,display:"flex",flexDirection:"column",gap:16}}>
        {/* Device info */}
        <div style={{background:"var(--b1)",borderRadius:9,border:"1px solid var(--br)",padding:16}}>
          <h3 style={{fontSize:11,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Device Info</h3>
          <Info label="Model" val={device.model}/>
          <Info label="OS" val={device.os}/>
          <Info label="Resolution" val={device.resolution}/>
          <Info label="Orientation" val={device.orientation}/>
          <Info label="IP Address" val={device.ip}/>
          <div style={{display:"flex",alignItems:"center",gap:12,marginTop:10}}>
            <div style={{display:"flex",alignItems:"center",gap:4}}><Batt l={device.battery}/><span style={{fontSize:10,color:"var(--f3)"}}>{device.battery}%</span></div>
            <Sig l={device.signal}/>
            {device.latency!=null&&device.status==="online"&&<span style={{fontSize:10,color:device.latency>30?"var(--amb)":"var(--f3)",fontFamily:"var(--m)"}}>{device.latency}ms</span>}
          </div>
        </div>

        {/* Active session */}
        <div style={{background:"var(--b1)",borderRadius:9,border:`1px solid ${cu?"rgba(76,141,245,.2)":"var(--br)"}`,padding:16}}>
          <h3 style={{fontSize:11,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Active Session</h3>
          {cu?(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"var(--blue)",animation:"pr 2s infinite"}}/>
                <span style={{fontSize:13,fontWeight:600,color:"var(--f)"}}>{cu.displayName}</span>
                <RB r={USERS.find(u=>u.id===cu.id)?.role||"user"}/>
              </div>
              <div style={{fontSize:11,color:"var(--f3)"}}>Connected for <span style={{color:"var(--blue)",fontFamily:"var(--m)",fontWeight:600}}>{fmtDur(elapsed)}</span></div>
            </div>
          ):(
            <div style={{fontSize:12,color:"var(--f3)"}}>No one connected</div>
          )}
        </div>

        {/* Actions */}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {canConnect&&<Btn variant="primary" onClick={()=>onConnect(device)} full><Ico d="M5 12h14M12 5l7 7-7 7" sz={13}/>Connect</Btn>}
          {isMeConnected&&<Btn variant="danger" onClick={handleDisconnect} full><Ico d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" sz={13}/>Disconnect</Btn>}
          {otherConnected&&!isAdmin&&<Btn disabled full>In use by {cu.displayName}</Btn>}
          {otherConnected&&isAdmin&&<Btn variant="danger" onClick={handleForceDisconnect} full><Ico d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" sz={13}/>Force Disconnect {cu.displayName}</Btn>}
          {device.status==="offline"&&<Btn disabled full>Device offline</Btn>}
          {device.status==="idle"&&!cu&&<Btn disabled full>Device idle</Btn>}
        </div>
      </div>

      {/* Right: session history */}
      <div style={{flex:1,background:"var(--b1)",borderRadius:9,border:"1px solid var(--br)",padding:16,display:"flex",flexDirection:"column"}}>
        <h3 style={{fontSize:11,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:12}}>Connection History</h3>
        <div style={{flex:1,overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{borderBottom:"1px solid var(--br)"}}>
              {["User","Started","Ended","Duration","Reason"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:9,fontWeight:600,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".05em"}}>{h}</th>)}
            </tr></thead>
            <tbody>{SESSIONS.map((s,i)=><tr key={i} style={{borderBottom:"1px solid var(--br)"}}>{[
              <td key="u" style={{padding:"8px 8px",color:"var(--f)",fontWeight:500}}>{s.user}</td>,
              <td key="s" style={{padding:"8px 8px",color:"var(--f3)",fontFamily:"var(--m)",fontSize:10}}>{s.started}</td>,
              <td key="e" style={{padding:"8px 8px",color:"var(--f3)",fontFamily:"var(--m)",fontSize:10}}>{s.ended}</td>,
              <td key="d" style={{padding:"8px 8px",color:"var(--f2)",fontFamily:"var(--m)",fontSize:10}}>{s.duration}</td>,
              <td key="r" style={{padding:"8px 8px"}}><span style={{fontSize:9,fontWeight:600,color:reasonColor(s.reason),textTransform:"uppercase"}}>{s.reason}</span></td>,
            ]}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
};

// ═══════════════════════════════════════════════════════
// REMOTE VIEW
// ═══════════════════════════════════════════════════════
const Ctrl=({children,label,onClick,danger})=><button onClick={onClick} title={label} style={{all:"unset",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"6px 9px",borderRadius:6,background:danger?"rgba(232,69,69,.08)":"var(--b2)",color:danger?"var(--red)":"var(--f2)",transition:"all .12s",fontSize:8,fontWeight:500}} onMouseEnter={e=>e.currentTarget.style.background=danger?"rgba(232,69,69,.15)":"var(--bh)"} onMouseLeave={e=>e.currentTarget.style.background=danger?"rgba(232,69,69,.08)":"var(--b2)"}>{children}<span>{label}</span></button>;

const Metrics=({d})=>{const M=({l,v,u,w})=><div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}><span style={{fontSize:8,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".04em"}}>{l}</span><span style={{fontSize:13,fontWeight:600,fontFamily:"var(--m)",color:w?"var(--amb)":"var(--f)"}}>{v}<span style={{fontSize:8,fontWeight:400,color:"var(--f3)"}}>{u}</span></span></div>;return<div style={{display:"flex",gap:18,padding:"7px 12px",background:"var(--b1)",borderRadius:6,border:"1px solid var(--br)"}}><M l="FPS" v={d.fps||0} u="" w={d.fps<24}/><M l="Bitrate" v={((d.bitrate||0)/1000).toFixed(1)} u="Mb"/><M l="Latency" v={d.latency||0} u="ms" w={d.latency>25}/><M l="Dropped" v={d.dropped||0} u="" w={d.dropped>5}/><M l="Battery" v={d.battery} u="%" w={d.battery<25}/></div>};

const PhoneScreen=({d})=>{const[t,sT]=useState(new Date());useEffect(()=>{const i=setInterval(()=>sT(new Date()),1000);return()=>clearInterval(i)},[]);const h=t.getHours().toString().padStart(2,"0"),m=t.getMinutes().toString().padStart(2,"0");return<div style={{width:"100%",height:"100%",background:"linear-gradient(160deg,#0b0e14 0%,#131820 50%,#172030 100%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#fff",fontFamily:"var(--s)",position:"relative",overflow:"hidden",userSelect:"none"}}><div style={{position:"absolute",top:0,left:0,right:0,padding:"6px 12px",display:"flex",justifyContent:"space-between",fontSize:9,opacity:.45}}><span>{d.name}</span><span>{d.battery}%</span></div><div style={{fontSize:58,fontWeight:300,letterSpacing:-3,lineHeight:1}}>{h}:{m}</div><div style={{fontSize:11,opacity:.3,marginTop:5}}>{t.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}</div><div style={{position:"absolute",width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,rgba(76,141,245,.1) 0%,transparent 70%)",top:"18%",left:"28%",animation:"gl 5s ease-in-out infinite"}}/></div>};

const RemoteView=({device,onBack,user,devices,setDevices})=>{
  const ref=useRef(null);const[log,sLog]=useState([]);const[conn,sConn]=useState(true);const[st,sSt]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>sConn(false),1600);return()=>clearTimeout(t)},[]);
  useEffect(()=>{if(conn)return;const i=setInterval(()=>sSt(s=>s+1),1000);return()=>clearInterval(i)},[conn]);
  const addLog=useCallback((t,d)=>sLog(p=>[...p.slice(-4),{t,d,ts:Date.now()}]),[]);
  const onTap=useCallback(e=>{if(conn)return;const r=ref.current.getBoundingClientRect();addLog("TAP",`(${((e.clientX-r.left)/r.width).toFixed(3)}, ${((e.clientY-r.top)/r.height).toFixed(3)})`)},[addLog,conn]);
  const onScroll=useCallback(e=>{if(conn)return;e.preventDefault();addLog("SCROLL",e.deltaY>0?"DOWN":"UP")},[addLog,conn]);

  const handleDisconnect=()=>{
    const updated=devices.map(dd=>dd.id===device.id?{...dd,connectedUser:undefined}:dd);
    setDevices(updated);
    onBack();
  };

  const S=({d:path,sz=14})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={path}/></svg>;
  const PS=({title,children})=><div style={{display:"flex",flexDirection:"column",gap:2}}><span style={{fontSize:8,color:"var(--f3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:3,fontWeight:600}}>{title}</span>{children}</div>;

  return<div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--b0)",animation:"fi .2s"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:"1px solid var(--br)",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={handleDisconnect} style={{all:"unset",cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:"var(--f2)",fontSize:11,fontWeight:500}} onMouseEnter={e=>e.currentTarget.style.color="var(--f)"} onMouseLeave={e=>e.currentTarget.style.color="var(--f2)"}><S d="M19 12H5M12 19l-7-7 7-7"/>Back</button>
        <span style={{color:"var(--br)"}}>|</span><Dot s={device.status}/>
        <span style={{fontSize:13,fontWeight:600,color:"var(--f)"}}>{device.name}</span>
        {!conn&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:3,background:"var(--blued)",color:"var(--blue)",fontFamily:"var(--m)",fontWeight:600}}>{Math.floor(st/60)}:{(st%60).toString().padStart(2,"0")}</span>}
      </div>
      <Metrics d={device}/>
    </div>
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:16,gap:16,minHeight:0}}>
      <div style={{position:"relative",borderRadius:22,border:"3px solid var(--brh)",overflow:"hidden",boxShadow:"0 8px 36px rgba(0,0,0,.4)",height:"min(100%,580px)",aspectRatio:"9/19.5",background:"#000",flexShrink:0}}>
        <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:68,height:18,background:"#000",borderRadius:"0 0 10px 10px",zIndex:15}}/>
        <div style={{width:"100%",height:"100%",position:"relative"}}><PhoneScreen d={device}/><div ref={ref} onClick={onTap} onWheel={onScroll} style={{position:"absolute",inset:0,cursor:conn?"wait":"crosshair",zIndex:10}}/>{conn&&<div style={{position:"absolute",inset:0,background:"rgba(7,8,10,.85)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,zIndex:20}}><div style={{width:32,height:32,border:"3px solid var(--br)",borderTopColor:"var(--blue)",borderRadius:"50%",animation:"sp .7s linear infinite"}}/><div style={{fontSize:12,fontWeight:600,color:"var(--f)"}}>Connecting...</div><div style={{fontSize:10,color:"var(--f3)"}}>Establishing WebRTC session</div></div>}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12,width:180,flexShrink:0}}>
        <PS title="Navigation"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}><Ctrl label="Back" onClick={()=>addLog("KEY","BACK")}><S d="M19 12H5M12 19l-7-7 7-7"/></Ctrl><Ctrl label="Home" onClick={()=>addLog("KEY","HOME")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/></svg></Ctrl><Ctrl label="Recents" onClick={()=>addLog("KEY","RECENTS")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></Ctrl></div></PS>
        <PS title="Actions"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}><Ctrl label="Keyboard" onClick={()=>addLog("CMD","KB")}><S d="M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M7 14h10"/></Ctrl><Ctrl label="Fullscreen" onClick={()=>addLog("CMD","FS")}><S d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></Ctrl><Ctrl label="Screenshot" onClick={()=>addLog("CMD","SS")}><S d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/></Ctrl><Ctrl label="Rotate" onClick={()=>addLog("CMD","ROT")}><S d="M21 2v6h-6M3 12a9 9 0 0115.36-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.36 6.36L3 16"/></Ctrl></div></PS>
        <PS title="System"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}><Ctrl label="Vol−" onClick={()=>addLog("KEY","V-")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg></Ctrl><Ctrl label="Vol+" onClick={()=>addLog("KEY","V+")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg></Ctrl><Ctrl label="Power" onClick={()=>addLog("KEY","PWR")} danger><S d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10"/></Ctrl></div></PS>
        <Ctrl label="Disconnect" onClick={handleDisconnect} danger><S d="M18.36 6.64A9 9 0 0120.77 15M2 12C2 6.48 6.48 2 12 2M15 2a10 10 0 014.65 3.5M1 1l22 22"/></Ctrl>
        <PS title="Input Log"><div style={{background:"var(--b2)",borderRadius:5,padding:6,fontFamily:"var(--m)",fontSize:8,color:"var(--f3)",minHeight:60,display:"flex",flexDirection:"column",gap:2}}>{log.length===0?<span style={{opacity:.4}}>Interact with screen...</span>:log.map((l,i)=><div key={i} style={{display:"flex",gap:4}}><span style={{color:"var(--blue)",fontWeight:600}}>{l.t}</span><span>{l.d}</span></div>)}</div></PS>
      </div>
    </div>
  </div>
};

// ═══════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════
export default function App(){
  const[user,sUser]=useState(null);
  const[view,sView]=useState("dash"); // dash | detail | remote
  const[sel,sSel]=useState(null);
  const[devices,sDevices]=useState(DEVICES);

  const openDetail=d=>{if(d.status==="offline")return;sSel(d);sView("detail")};
  const connect=d=>{
    const updated=devices.map(dd=>dd.id===d.id?{...dd,connectedUser:{id:user.id,displayName:user.displayName,since:Date.now()}}:dd);
    sDevices(updated);
    sSel({...d,connectedUser:{id:user.id,displayName:user.displayName,since:Date.now()}});
    sView("remote");
  };
  const backToDetail=()=>{
    const fresh=devices.find(dd=>dd.id===sel.id);
    sSel(fresh);
    sView("detail");
  };
  const logout=()=>{sUser(null);sView("dash");sSel(null)};
  const isAdmin=user?.role==="admin";
  const onC=devices.filter(d=>d.status==="online").length;
  const idC=devices.filter(d=>d.status==="idle").length;

  // keep sel in sync with devices
  useEffect(()=>{if(sel){const fresh=devices.find(d=>d.id===sel.id);if(fresh)sSel(fresh)}},[devices]);

  return<div style={{width:"100%",height:"100vh",background:"var(--b0)",color:"var(--f)",fontFamily:"var(--s)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <style>{CSS}</style>
    {!user?<Login onLogin={sUser}/>:view==="dash"?(
      <div style={{display:"flex",flexDirection:"column",height:"100%",animation:"fu .3s"}}>
        <div style={{padding:"12px 22px",borderBottom:"1px solid var(--br)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:28,height:28,borderRadius:6,background:"var(--blued)",display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div><div><h1 style={{fontSize:14,fontWeight:700,color:"var(--f)",lineHeight:1.2}}>Remote Desktop</h1><span style={{fontSize:9,color:"var(--f3)"}}>{devices.length} devices</span></div></div>
          <div style={{display:"flex",gap:16,alignItems:"center"}}><div style={{display:"flex",gap:12,fontSize:10}}><span style={{color:"var(--grn)"}}>{onC} online</span><span style={{color:"var(--amb)"}}>{idC} idle</span><span style={{color:"var(--f3)"}}>{devices.length-onC-idC} offline</span></div>{isAdmin&&<Btn variant="ghost" onClick={()=>{}}>+ Pair Device</Btn>}<UserMenu user={user} onLogout={logout}/></div>
        </div>
        <div style={{flex:1,overflow:"auto",padding:22}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(205px,245px))",gap:11,maxWidth:1400}}>
            {devices.map((d,i)=><div key={d.id} style={{animation:`fu .3s ease ${i*.04}s both`}}><DeviceCard d={d} onClick={openDetail}/></div>)}
            {isAdmin&&devices.length<10&&<button style={{all:"unset",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",border:"2px dashed var(--br)",borderRadius:9,height:164,color:"var(--f3)",fontSize:10,gap:6,transition:"all .2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.color="var(--blue)"}} onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--br)";e.currentTarget.style.color="var(--f3)"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg>Pair new device</button>}
          </div>
        </div>
        <div style={{padding:"7px 22px",borderTop:"1px solid var(--br)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:9,color:"var(--f3)",flexShrink:0}}><span>SignalR · WebRTC · PostgreSQL</span><div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{width:5,height:5,borderRadius:"50%",background:"var(--grn)"}}/>Server connected</div></div>
      </div>
    ):view==="detail"?(
      <DeviceDetail device={sel} user={user} onBack={()=>sView("dash")} onConnect={connect} devices={devices} setDevices={sDevices}/>
    ):(
      <RemoteView device={sel} onBack={backToDetail} user={user} devices={devices} setDevices={sDevices}/>
    )}
  </div>
}
