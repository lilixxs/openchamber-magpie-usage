(()=>{var u="openchamber.sdk",E=1;var je=`
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [data-oc-scrolling] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [data-oc-scrolling] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [data-oc-scrolling]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [data-oc-scrolling] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function ze(e){let r=e.documentElement;if(r.hasAttribute("data-oc-scrollbar-activity"))return;r.setAttribute("data-oc-scrollbar-activity","");let n=new WeakMap;e.addEventListener("scroll",(p)=>{let _=p.target===e?r:p.target;if(!(_ instanceof Element))return;if(!_.hasAttribute("data-oc-scrolling"))_.setAttribute("data-oc-scrolling","");let g=n.get(_);if(g!==void 0)clearTimeout(g);n.set(_,setTimeout(()=>{n.delete(_),_.removeAttribute("data-oc-scrolling")},1000))},{capture:!0,passive:!0})}var Wo=`(${ze.toString()})(document);`;var Ke=128,We=65536;var Oe=128;var xe=65536;var Jt=/^[a-z][a-z0-9-]{0,39}$/;var zt=(e)=>Object(e)===e&&!Array.isArray(e),Je=(e,r)=>Object.keys(e).every((n)=>r.includes(n)),Kt=(e)=>String(e)===e&&e.length>=1&&e.length<=60,Wt=(e)=>String(e)===e&&e.length>=1&&e.length<=80,Yt=(e)=>{if(!Array.isArray(e)||e.length>4)return!1;let r=new Set;for(let n of e){if(!zt(n)||!Jt.test(n.id)||!Kt(n.label))return!1;if(n.disabled!==void 0&&n.disabled!==!0&&n.disabled!==!1)return!1;if(r.has(n.id))return!1;if(r.add(n.id),n.kind==="button"){if(!Je(n,["kind","id","label","disabled"]))return!1;continue}if(n.kind!=="select"||!Je(n,["kind","id","label","value","options","disabled"]))return!1;if(!Wt(n.value)||!Array.isArray(n.options)||n.options.length<1||n.options.length>16)return!1;let p=new Set;for(let _ of n.options){if(!zt(_)||!Je(_,["value","label"])||!Wt(_.value)||!Kt(_.label)||p.has(_.value))return!1;p.add(_.value)}if(!p.has(n.value))return!1}return!0};var Ae=20000000,be=256;var Ye=(e)=>("bytes"in e)?e.bytes.byteLength:e.content.length,Qt=(e,r)=>{if(e.path!==r.path||e.readOnly!==r.readOnly)return!1;if(e.encoding==="text"||r.encoding==="text")return e.encoding==="text"&&r.encoding==="text"&&e.content===r.content;if(e.bytes.byteLength!==r.bytes.byteLength)return!1;for(let n=0;n<e.bytes.byteLength;n+=1)if(e.bytes[n]!==r.bytes[n])return!1;return!0};var Zt=/^[A-Za-z0-9_-]{1,80}$/;var qt=["left","right","top","bottom"];var eo=(e,r=0,n={remaining:16000})=>{if(--n.remaining<0||r>=32)return!1;if(e===null)return!0;let p=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let _ of p)if(!eo(_,r+1,n))return!1;return!0},Qe=(e)=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every((r)=>/^(0|[1-9]\d*)$/.test(r)&&Number(r)<e.length)&&e.every(Qe);if(Object(e)===e){let r=Object.getPrototypeOf(e);return(r===null||r===Object.prototype)&&Object.values(e).every(Qe)}return String(e)===e||Number.isFinite(e)},Ze=(e)=>{try{if(String(e.id)!==e.id||!Zt.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!qt.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!eo(e.data)||!Qe(e.data))return!1;return JSON.stringify(e.data).length<=16000}catch{return!1}};var oo=["file","directory","other","missing"],et=(e)=>Boolean(e&&"sessionId"in e),tt=(e)=>Boolean(e&&"sent"in e&&!("sessionId"in e));var ro=/^[0-9a-f]{7,64}$/i,ot=(e)=>ro.test(e),ge=500,ke=32000,no=16000,so=128,io=200,ao=2000,co=16000,lo=80,po=200,uo=16000;var Eo=2000;var rt=20000,Re=1024,ye=2000000;var Ue=64000,ve=8000,nt=4000;var st=960000;var _o=999,fo=1e4,pe=500,So=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],To=["stopped","starting","ready","failed"],Jo=new Set(So),mo=(e)=>Jo.has(e),ho=(e)=>e&&mo(e)?e:"HOST_REJECTED",Q=(e)=>{if(e===void 0)return!1;if(e===null||e===!0||e===!1)return!0;if(String(e)===e)return!0;if(Number(e)===e)return Number.isFinite(e);if(Array.isArray(e))return e.every(Q);if(Object(e)===e)return Object.values(e).every(Q);return!1},Oo=(e)=>Q(e)&&JSON.stringify(e).length<=uo,to=(e)=>e?.trim().slice(0,po)??"",Z=(e)=>{let r=e.id.trim().slice(0,so),n=e.title.trim().slice(0,io),p=e.url.trim().slice(0,ao),_=e.text?.trim().slice(0,co),g=e.author?.trim().slice(0,lo),N=e.kind==="pull"?"pull":"issue",I={providerId:e.providerId.trim(),id:r,title:n||r,url:p,kind:N};if(_)I.text=_;if(g)I.author=g;if(N==="pull"){let G=to(e.branches?.head),B=to(e.branches?.base);if(G&&B)I.branches={head:G,base:B}}if(Oo(e.data))I.data=e.data;return I},it=(e)=>{let r=Z(e);if(e.projectId)r.projectId=e.projectId;if(e.navigation)r.navigation=e.navigation;if(e.worktree)r.worktree=e.worktree;return r},at=(e)=>{let r={text:e.text.trim().slice(0,no)};if(e.send)r.send=!0;return r},ct=(e)=>{if(e===null||!Number.isFinite(e))return null;return Math.min(_o,Math.max(0,Math.round(e)))},dt=(e)=>{if(!Number.isFinite(e))return 0;return Math.min(fo,Math.max(0,Math.ceil(e)))};var q=(e)=>e.length>0&&e.length<=Re&&!e.includes("\x00")&&!e.includes("\\");var Ce=(e)=>{if(!e.startsWith("/")||e.includes("\x00")||e.includes("\\")||e.includes("://"))return!1;if(e.length>Eo)return!1;return!e.split("/").some((n)=>n==="."||n==="..")},Yo=new Set(To),lt=(e)=>Boolean(e&&"status"in e&&Yo.has(String(e.status))&&!("body"in e)),Ie=(e)=>Boolean(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),pt=(e)=>Boolean(e&&"content"in e&&String(e.content)===e.content),ut=(e)=>Boolean(e&&"written"in e&&e.written===!0),Et=(e)=>Boolean(e&&"entries"in e&&Array.isArray(e.entries)),Qo=new Set(oo),_t=(e)=>Boolean(e&&"kind"in e&&"size"in e&&Qo.has(String(e.kind))&&Number.isFinite(e.size)),ft=(e)=>Boolean(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),Zo=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late"]),qo=(e)=>Object(e)===e?e:null,qe=(e)=>String(e)===e&&e.length>0,er=(e)=>{if(!qe(e.id))return null;if(e.ok===!0){let r={channel:u,v:E,type:"result",id:e.id,ok:!0};if(Object(e.payload)===e.payload)r.payload=e.payload;return r}if(e.ok===!1&&qe(e.error))return{channel:u,v:E,type:"result",id:e.id,ok:!1,error:e.error,code:ho(qe(e.code)?e.code:void 0)};return null},St=(e)=>{let r=qo(e);if(!r||r.channel!==u||r.v!==E)return null;if(r.type==="result")return er(r);if(!Zo.has(String(r.type))||Object(r.payload)!==r.payload)return null;return r};var xo=(e)=>("key"in e)&&("metaKey"in e)&&("ctrlKey"in e),tr=(e)=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s";class a extends Error{code;constructor(e,r){super(r);this.name="HostRequestError",this.code=e}}var Ao=()=>Promise.reject(new a("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),we=()=>Promise.reject(new a("BAD_PATH",`File path must be 1 to ${Re} characters without NUL or backslash.`)),Le=(e)=>{if(e===void 0)return;if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new a("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0},l=(e)=>(e.value+=1,`oc-${e.value}`),Tt=(e={})=>{let r=e.target??("window"in globalThis?window:null);if(!r)throw new a("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let n=e.acceptSource??((t)=>t===r.parent),p=e.requestTimeoutMs??rt,_=new Set,g=new Set,N=new Set,I=new Set,G=new Set,B=new Set,ne=new Set,Ee=new Set,_e=new Set,K=new Set,$e=[],se=null,ie=null,fe=new Set,Se=new Set,ae=null,ce=null,Xe=!1,W=new Map,J=new Map,Y=new Map,D=!1,d={value:0},c=null,H=null,de=!1,le=!1,Mt=null,Nt=(t)=>{if(!t)return null;return{sessionId:t.id,phase:t.busy?"started":"completed"}},w=(t)=>{r.parent.postMessage(t,"*")},Pt=()=>{if(D||r.parent===r||K.size===0||c?.features?.lateGenerateResults!==!0)return;w({channel:u,v:E,type:"generate-late-listen"})},h=(t,o)=>{for(let s of t)try{s(o)}catch(i){console.error(i)}},Gt=(t)=>{if(!(t instanceof MessageEvent))return;if(!n(t.source))return;let o=St(t.data);if(!o)return;if(o.type==="workspace"){let i=J.get(o.payload.subscriptionId);if(i)h([i],o.payload.snapshot);return}if(o.type==="shells"){let i=Y.get(o.payload.subscriptionId);if(i)h([i],o.payload.snapshot);return}if(o.type==="ready"){if(c=o.payload,H=Nt(o.payload.session),h(_,o.payload),h(g,o.payload.directory),h(N,o.payload.session),H)h(I,H);h(G,o.payload.connection),h(B,o.payload.settings),h(ne,o.payload.item),Pt();return}if(o.type==="generate-late"){if(K.size===0)$e.push(o.payload);else h(K,o.payload);return}if(o.type==="directory"){if(c)c={...c,directory:o.payload.directory};h(g,o.payload.directory);return}if(o.type==="session"){if(c)c={...c,session:o.payload.session};if(!o.payload.session)H=null;else if(H?.sessionId!==o.payload.session.id)H=Nt(o.payload.session);h(N,o.payload.session);return}if(o.type==="session-lifecycle"){H=o.payload,h(I,o.payload);return}if(o.type==="connection"){if(c)c={...c,connection:o.payload.connection};h(G,o.payload.connection);return}if(o.type==="settings"){if(c)c={...c,settings:o.payload.settings};h(B,o.payload.settings);return}if(o.type==="item"){if(c)c={...c,item:o.payload.item};h(ne,o.payload.item);return}if(o.type==="status-control-event"){h(Ee,o.payload);return}if(o.type==="popover-closed"){h(_e,o.payload);return}if(o.type==="action"){let i=(f)=>{if(!D)w({channel:u,v:E,type:"action-result",id:o.id,payload:f})},S=ie;if(!S){i({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>S(o.payload)).then(()=>i({ok:!0}),(f)=>{let b=(f instanceof Error?f.message:String(f)).trim();i({ok:!1,error:(b||"Action failed.").slice(0,pe)})});return}if(o.type==="file-open"){let i=o.payload;if(ce&&Qt(ce,i))return;ce=i,h(fe,o.payload);return}if(o.type==="file-saved"){h(Se,o.payload.version);return}if(o.type==="file-snapshot"){let i=(b)=>{if(!D)w({channel:u,v:E,type:"file-snapshot-result",id:o.id,payload:b})},S=(b)=>i({error:(b.trim()||"Could not read the edited file.").slice(0,pe)}),f=ae;if(!f){S("This extension does not edit files.");return}Promise.resolve().then(()=>f(o.payload.purpose)).then((b)=>{if(Ye(b)>Ae){S(`The file is over ${Ae} ${"bytes"in b?"bytes":"characters"}.`);return}if(b.version.length>be){S(`The snapshot version is over ${be} characters.`);return}i({snapshot:"bytes"in b?{bytes:b.bytes,version:b.version}:{content:b.content,version:b.version}})},(b)=>S(b instanceof Error?b.message:String(b)));return}if(o.type==="resolve"){let i=(f)=>{w({channel:u,v:E,type:"resolve-result",id:o.id,payload:f})},S=se;if(!S){i({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>S(o.payload)).then((f)=>i({item:f?Z(f):null}),(f)=>{let b=(f instanceof Error?f.message:String(f)).trim();i({error:(b||"Command failed.").slice(0,pe)})});return}let s=W.get(o.id);if(!s)return;if(clearTimeout(s.timer),W.delete(o.id),o.ok){s.resolve(o.payload);return}s.reject(new a(o.code,o.error))};r.addEventListener("message",Gt),w({channel:u,v:E,type:"hello"});let v=(t,o=p)=>{if(D||r.parent===r)return Promise.reject(new a("HOST_UNAVAILABLE","No host frame. This page is not in an iframe."));return new Promise((s,i)=>{let S=setTimeout(()=>{W.delete(t.id),i(new a("HOST_TIMEOUT","Host did not answer in time."))},o);W.set(t.id,{resolve:s,reject:i,timer:S}),w(t)})},x=(t)=>v(t).then(()=>{return}),A={channel:u,v:E},Fe=(t)=>{if(!D&&r.parent!==r)w(t)},Dt=()=>Fe({...A,type:"file-save"}),Ht=(t)=>{if(!xo(t)||!tr(t))return;t.preventDefault(),Dt()},$t=(t)=>{if(!xo(t)||t.key!=="Escape"||c?.surface!=="popover"||!c.popover)return;t.preventDefault(),Vt(c.popover.id,"escape").catch(()=>{return})},Te=()=>{let t=c?.surface==="popover"?c.popover:void 0;if(!t)return;let o=de||le;if(Mt===o)return;Mt=o,jt(t.id,o).catch(()=>{return})},me=()=>{if(c?.surface!=="popover"||de)return;de=!0,Te()},Xt=(t)=>{if(c?.surface!=="popover"||t.relatedTarget!==null||!de)return;de=!1,Te()},Ft=()=>{if(c?.surface!=="popover"||le)return;le=!0,Te()},Bt=()=>{if(c?.surface!=="popover"||!le)return;le=!1,Te()},P=(t,o=1024)=>{if(!t.trim()||t.length>o)throw new a("HOST_REJECTED",`Identity must contain 1 to ${o} characters.`)},Be=async(t)=>{if(t.kind!=="projects")P(t.projectId);let o=await v({...A,type:"workspace-read",id:l(d),payload:t});if(!o||!("kind"in o)||!("state"in o)||o.kind!==t.kind)throw new a("HOST_REJECTED","Host did not return workspace data.");return o},Ve=async(t,o)=>{if(t.kind!=="projects")P(t.projectId);let s=l(d);J.set(s,o);try{await x({...A,type:"workspace-subscribe",id:l(d),payload:{subscriptionId:s,query:t}})}catch(i){if(J.delete(s),!D)w({...A,type:"workspace-unsubscribe",id:l(d),payload:{subscriptionId:s}});throw i}return()=>{if(!J.delete(s)||D)return;w({...A,type:"workspace-unsubscribe",id:l(d),payload:{subscriptionId:s}})}},Ko=async(t,o)=>{if(t.kind==="session")P(t.sessionId);if(t.kind==="project")P(t.projectId);let s=l(d);Y.set(s,o);try{await x({...A,type:"shells-subscribe",id:l(d),payload:{subscriptionId:s,scope:t}})}catch(i){if(Y.delete(s),!D)w({...A,type:"shells-unsubscribe",id:l(d),payload:{subscriptionId:s}});throw i}return()=>{if(!Y.delete(s)||D)return;w({...A,type:"shells-unsubscribe",id:l(d),payload:{subscriptionId:s}})}},he=async(t)=>{if("key"in t&&(t.key.length===0||t.key.length>Ke))throw new a("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!Q(t.value))throw new a("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>We)throw new a("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&c?.features?.deviceStorage!==!0)throw new a("UNSUPPORTED","This host does not support device storage.");let o=await v({...A,type:"storage",id:l(d),payload:t});if(!o||!("storage"in o)||o.op!==t.op)throw new a("HOST_REJECTED","Host did not return storage data.");return o},Vt=(t,o)=>c?.features?.popovers!==!0&&!(c?.surface==="popover"&&c.popover?.id===t)?Promise.reject(new a("UNSUPPORTED","This host does not support popovers.")):x({...A,type:"popover-close",id:l(d),payload:o?{id:t,reason:o}:{id:t}}),jt=(t,o)=>c?.features?.popovers!==!0&&!(c?.surface==="popover"&&c.popover?.id===t)?Promise.reject(new a("UNSUPPORTED","This host does not support popovers.")):x({...A,type:"popover-anchor",id:l(d),payload:{id:t,active:o}});return r.addEventListener("keydown",$t,!0),r.addEventListener("pointerover",me),r.addEventListener("pointermove",me),r.addEventListener("pointerout",Xt),r.addEventListener("focus",Ft),r.addEventListener("blur",Bt),{onAction:(t)=>(ie=t,()=>{if(ie===t)ie=null}),listProjects:async()=>{let t=await Be({kind:"projects"});if(t.kind!=="projects")throw new a("HOST_REJECTED","Expected projects.");return t},listWorktrees:async(t)=>{let o=await Be({kind:"worktrees",projectId:t});if(o.kind!=="worktrees")throw new a("HOST_REJECTED","Expected worktrees.");return o},listSessions:async(t)=>{let o=await Be({kind:"sessions",projectId:t});if(o.kind!=="sessions")throw new a("HOST_REJECTED","Expected sessions.");return o},onProjects:(t)=>Ve({kind:"projects"},(o)=>{if(o.kind==="projects")t(o)}),onWorktrees:(t,o)=>Ve({kind:"worktrees",projectId:t},(s)=>{if(s.kind==="worktrees")o(s)}),onSessions:(t,o)=>Ve({kind:"sessions",projectId:t},(s)=>{if(s.kind==="sessions")o(s)}),onRunningShells:(t,o)=>Ko(t,o),readShellOutput:async(t,o)=>{P(t,Oe);let s=o?.cursor;if(s!==void 0&&(!Number.isInteger(s)||s<0))throw new a("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let i=o?.tailBytes;if(i!==void 0&&(!Number.isInteger(i)||i<1||i>xe))throw new a("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${xe}.`);let f=await v({...A,type:"shell-output",id:l(d),payload:{shellId:t,cursor:s,tailBytes:i}});if(!f||typeof f.output!=="string"||!Number.isFinite(f.cursor))throw new a("HOST_REJECTED","Host did not return shell output.");return f},stopShell:async(t)=>{if(P(t,Oe),(await v({...A,type:"shell-stop",id:l(d),payload:{shellId:t}}))?.stopped!==!0)throw new a("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async(t)=>{P(t),await x({...A,type:"open-session",id:l(d),payload:{sessionId:t}})},storage:{get:async(t,o)=>{let s=Le(o),i={op:"get",key:t};if(s)i.scope=s;let S=await he(i);return S.op==="get"&&S.found?S.value:void 0},set:async(t,o,s)=>{let i=Le(s),S={op:"set",key:t,value:o};if(i)S.scope=i;await he(S)},delete:async(t,o)=>{let s=Le(o),i={op:"delete",key:t};if(s)i.scope=s;await he(i)},keys:async(t)=>{let o=Le(t),s={op:"keys"};if(o)s.scope=o;let i=await he(s);if(i.op!=="keys")throw new a("HOST_REJECTED","Expected storage keys.");return i.keys}},onReady:(t)=>{if(_.add(t),c)t(c);return()=>{_.delete(t)}},onDirectory:(t)=>{if(g.add(t),c)t(c.directory);return()=>{g.delete(t)}},onSession:(t)=>{if(N.add(t),c)t(c.session);return()=>{N.delete(t)}},onSessionLifecycle:(t)=>{if(I.add(t),H)t(H);return()=>{I.delete(t)}},onConnection:(t)=>{if(G.add(t),c)t(c.connection);return()=>{G.delete(t)}},onSettings:(t)=>{if(B.add(t),c)t(c.settings);return()=>{B.delete(t)}},onItem:(t)=>{if(ne.add(t),c)t(c.item);return()=>{ne.delete(t)}},onStatusControl:(t)=>(Ee.add(t),()=>{Ee.delete(t)}),onPopoverClosed:(t)=>(_e.add(t),()=>{_e.delete(t)}),setStatusControls:(t)=>{if(c?.features?.statusControls!==!0)return Promise.reject(new a("UNSUPPORTED","This host does not support status controls."));if(!Yt(t))return Promise.reject(new a("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options."));return x({...A,type:"status-controls",id:l(d),payload:{controls:t}})},openPopover:(t)=>{if(c?.features?.popovers!==!0)return Promise.reject(new a("UNSUPPORTED","This host does not support popovers."));if(!Ze(t))return Promise.reject(new a("HOST_REJECTED","Popover requests need bounded geometry and JSON data."));return x({...A,type:"popover-open",id:l(d),payload:t})},closePopover:Vt,setPopoverAnchorActive:jt,onResolve:(t)=>(se=t,()=>{if(se===t)se=null}),toast:(t)=>{let o=t.message.trim();if(!o||o.length>ge)return Promise.reject(new a("HOST_REJECTED",`Toast message must contain 1 to ${ge} characters.`));if(t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>ke))return Promise.reject(new a("HOST_REJECTED",`Toast copy text must contain 1 to ${ke} characters.`));return x({channel:u,v:E,type:"toast",id:l(d),payload:{...t,message:o}})},openUrl:(t)=>x({channel:u,v:E,type:"open-url",id:l(d),payload:{url:t}}),openCommit:(t)=>ot(t)?x({channel:u,v:E,type:"open-commit",id:l(d),payload:{sha:t}}):Promise.reject(new a("HOST_REJECTED","Commit id must be 7 to 64 hex characters.")),openSurface:(t)=>x({channel:u,v:E,type:"open-surface",id:l(d),payload:{surfaceId:t}}),writeClipboard:(t)=>x({channel:u,v:E,type:"clipboard-write",id:l(d),payload:{text:t}}),compose:(t)=>x({channel:u,v:E,type:"compose",id:l(d),payload:t}),attach:(t)=>x({channel:u,v:E,type:"attach",id:l(d),payload:Z(t)}),startSession:async(t)=>{if(t.projectId!==void 0)P(t.projectId);let o=t.worktree;if(o&&o!==!0)if(o.kind==="existing")P(o.directory);else{if(o.name!==void 0)P(o.name,200);if(o.baseBranch!==void 0)P(o.baseBranch,200)}let s=await v({channel:u,v:E,type:"start-session",id:l(d),payload:it(t)},e.requestTimeoutMs??180000);if(!et(s))throw new a("HOST_REJECTED","Host did not return a session.");return s},prompt:(t)=>v({channel:u,v:E,type:"prompt",id:l(d),payload:at(t)}).then((o)=>{if(!tt(o))throw new a("HOST_REJECTED","Host did not return a prompt result.");return o}),sessionLink:(t)=>x({channel:u,v:E,type:"session-link",id:l(d),payload:Z(t)}),close:()=>x({channel:u,v:E,type:"close",id:l(d)}),oauthStart:()=>x({channel:u,v:E,type:"oauth-start",id:l(d)}),oauthDisconnect:()=>x({channel:u,v:E,type:"oauth-disconnect",id:l(d)}),request:(t)=>(Ce(t.path)?v({channel:u,v:E,type:"request",id:l(d),payload:t}):Ao()).then((o)=>{if(!Ie(o))throw new a("HOST_REJECTED","Host request result was empty.");return o}),serviceRequest:(t)=>(Ce(t.path)?v({channel:u,v:E,type:"service-request",id:l(d),payload:t}):Ao()).then((o)=>{if(!Ie(o))throw new a("HOST_REJECTED","Host service request result was empty.");return o}),serviceStatus:()=>v({channel:u,v:E,type:"service-status",id:l(d)}).then((t)=>{if(!lt(t))throw new a("HOST_REJECTED","Host did not return service status.");return t}),readFile:(t)=>(q(t)?v({channel:u,v:E,type:"file-read",id:l(d),payload:{path:t}}):we()).then((o)=>{if(!pt(o))throw new a("HOST_REJECTED","Host did not return file content.");return o}),writeFile:(t,o)=>{if(!q(t))return we();if(o.length>ye)return Promise.reject(new a("FILE_TOO_LARGE",`Content is over ${ye} characters.`));return v({channel:u,v:E,type:"file-write",id:l(d),payload:{path:t,content:o}}).then((s)=>{if(!ut(s))throw new a("HOST_REJECTED","Host did not confirm the write.");return s})},listDir:(t)=>(q(t)?v({channel:u,v:E,type:"file-list",id:l(d),payload:{path:t}}):we()).then((o)=>{if(!Et(o))throw new a("HOST_REJECTED","Host did not return directory entries.");return o}),stat:(t)=>(q(t)?v({channel:u,v:E,type:"file-stat",id:l(d),payload:{path:t}}):we()).then((o)=>{if(!_t(o))throw new a("HOST_REJECTED","Host did not return file status.");return o}),generate:(t)=>{let o=t.prompt.trim(),s=t.system?.trim();if(o.length===0||o.length>Ue)return Promise.reject(new a("HOST_REJECTED",`Prompt must be 1 to ${Ue} characters.`));if(s!==void 0&&(s.length===0||s.length>ve))return Promise.reject(new a("HOST_REJECTED",`System prompt must be 1 to ${ve} characters.`));let i=t.maxOutputTokens===void 0?void 0:Math.min(nt,Math.max(1,Math.floor(t.maxOutputTokens)));if(i!==void 0&&!Number.isFinite(i))return Promise.reject(new a("HOST_REJECTED","maxOutputTokens must be a number."));let S={prompt:o};if(s!==void 0)S.system=s;if(i!==void 0)S.maxOutputTokens=i;return v({channel:u,v:E,type:"generate",id:l(d),payload:S},e.requestTimeoutMs??st).then((f)=>{if(!ft(f))throw new a("HOST_REJECTED","Host did not return generated text.");return f})},onLateGenerateResult:(t)=>{K.add(t);for(let o of $e.splice(0))h([t],o);return Pt(),()=>{K.delete(t)}},setBadge:(t)=>x({channel:u,v:E,type:"badge",id:l(d),payload:{count:ct(t)}}),setHeight:(t)=>x({channel:u,v:E,type:"resize",id:l(d),payload:{height:dt(t)}}),onFileOpen:(t)=>{if(fe.add(t),!Xe)Xe=!0,r.addEventListener("keydown",Ht,!0);if(ce)t(ce);return()=>{fe.delete(t)}},onFileSnapshot:(t)=>(ae=t,()=>{if(ae===t)ae=null}),onFileSaved:(t)=>(Se.add(t),()=>{Se.delete(t)}),reportFileChange:(t)=>Fe({...A,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:Dt,reportFileUnsupported:()=>Fe({...A,type:"file-unsupported"}),dispose:()=>{for(let t of J.keys())w({...A,type:"workspace-unsubscribe",id:l(d),payload:{subscriptionId:t}});J.clear();for(let t of Y.keys())w({...A,type:"shells-unsubscribe",id:l(d),payload:{subscriptionId:t}});if(Y.clear(),D=!0,se=null,ie=null,ae=null,fe.clear(),Se.clear(),Xe)r.removeEventListener("keydown",Ht,!0);r.removeEventListener("message",Gt),r.removeEventListener("keydown",$t,!0),r.removeEventListener("pointerover",me),r.removeEventListener("pointermove",me),r.removeEventListener("pointerout",Xt),r.removeEventListener("focus",Ft),r.removeEventListener("blur",Bt);for(let t of W.values())clearTimeout(t.timer),t.reject(new a("HOST_UNAVAILABLE","Host client was disposed."));W.clear(),_.clear(),g.clear(),N.clear(),I.clear(),G.clear(),B.clear(),ne.clear(),Ee.clear(),_e.clear(),K.clear(),$e.length=0}}};var bo=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var Dr=new Set(bo);var go=["none","agent","user"];var $r=new Set(go);var or=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],rr=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],ko=(e,r)=>{r.style.colorScheme=e.mode;for(let[n,p]of or)r.style.setProperty(n,e.tokens[p]);for(let[n,p,_]of rr){let g=e.tokens[_]??"";r.style.setProperty(n,g),r.style.setProperty(p,g)}r.style.setProperty("font-family",e.tokens.font),r.style.setProperty("font-size","0.875rem"),r.style.setProperty("line-height","1.45"),r.style.setProperty("color",e.tokens.foreground)},mt=(e,r)=>{if(ko(e.theme,r),r.dataset)r.dataset.ocSurface=e.surface,r.dataset.ocTheme=e.theme.mode};var nr={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},m=(e,r)=>`var(--${e}, var(--oc-${nr[e]}, ${r}))`,F=m("surface-background","transparent"),Ne=m("surface-elevated","transparent"),ee=m("surface-elevated-foreground","inherit"),L=m("surface-foreground","inherit"),T=m("surface-muted-foreground","gray"),sr=m("surface-muted","transparent"),V=m("interactive-border","currentColor"),C=m("interactive-hover","transparent"),z=m("interactive-active","transparent"),ht=m("interactive-selection","transparent"),Ot=m("interactive-selection-foreground","inherit"),X=m("primary","currentColor"),xt=m("primary-text","inherit"),At=m("error-text","inherit"),ir=m("font-sans","inherit"),bt=m("font-mono","monospace"),Co=m("radius","9px"),gt=`calc(${Co} - 2px)`,Ro=`calc(${Co} - 4px)`,O=(e,r,n="transparent")=>`color-mix(in srgb, ${e} ${r}%, ${n})`,yo=`background-image: linear-gradient(${C}, ${C});`,kt=(e)=>`box-shadow: inset 0 0 0 1px ${e}, var(--oc-sdk-field-lift);`,Rt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",Uo="box-shadow: var(--oc-sdk-lit);",vo=`inset 0 1px 0 0 ${O(L,1.5)}, 0 1px 1px 0 rgb(0 0 0 / 0.28), 0 2px 3px -2px rgb(0 0 0 / 0.2)`,ar=`
:root {
  --oc-sdk-edge: ${O(L,10)};
  --oc-sdk-field-bg: ${Ne};
  --oc-sdk-raised-bg: ${F};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 2px 0 rgb(0 0 0 / 0.06);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.45), 0 1px 2px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.1);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.8), inset 0 0 0 1px rgb(0 0 0 / 0.04), 0 1px 2px -0.5px rgb(0 0 0 / 0.08), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.08);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${O(L,6)};
  --oc-sdk-field-bg: ${O(F,50,Ne)};
  --oc-sdk-raised-bg: ${Ne};
  --oc-sdk-field-lift: ${vo};
  --oc-sdk-raised-lift: ${vo};
  --oc-sdk-lit: inset 0 1px 0 0 ${O(L,1.5)}, 0 1px 1px 0 rgb(0 0 0 / 0.28), 0 2px 3px -2px rgb(0 0 0 / 0.2);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.36);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.06), inset 0 0 0 1px rgb(255 255 255 / 0.08), 0 1px 1px -0.5px rgb(0 0 0 / 0.22), 0 3px 3px -1.5px rgb(0 0 0 / 0.2), 0 6px 6px -3px rgb(0 0 0 / 0.16);
}`,Me=(e)=>{let r=m(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${r}; --oc-sdk-tone-text: ${m(`${e}-text`,"inherit")}; }`},cr=`
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 12px; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: 6px; height: 28px; padding: 0 10px; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: 4px; height: 24px; padding: 0 8px; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: 14px; height: 14px; }

.oc-sdk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: 8px 10px; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: 34px; padding-right: 34px; }
.oc-sdk-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: 24px; height: 24px; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: 2px; min-width: 160px; max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); overflow: auto; padding: 4px; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: 2px 2px 4px; }
.oc-sdk-popup-search .oc-sdk-input { height: 28px; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: 14px; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: 8px; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-top: 3px; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: 36px; height: 20px; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: 2px; padding: 2px; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: 1px 6px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: 16px 8px; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px 16px; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: 12px; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: 16px; height: 16px; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: 12px; height: 12px; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: 8px; width: 100%; margin: 8px 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: 4px 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: 6px; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: 8px 0; }
`,Io=`${ar}
.oc-sdk { color: ${L}; font-family: ${ir}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${yo} }
.oc-sdk-mono { font-family: ${bt}; }
.oc-sdk-muted { color: ${T}; }
${Me("success")}${Me("warning")}${Me("error")}${Me("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${X}; --oc-sdk-tone-text: ${xt}; }

.oc-sdk-btn { border-radius: ${gt}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${Ro}; }
.oc-sdk-btn[data-variant="default"] { color: ${xt}; background: ${O(X,10,F)}; border-color: ${O(X,12)}; ${Uo} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${O(X,16,F)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${O(X,22,F)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${sr}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${C}, ${C}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${z}, ${z}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${ee}; ${Rt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${C}, ${C}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${z}, ${z}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${C}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${z}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${m("status-error","red")}; color: ${At}; background: ${O("var(--oc-sdk-tone)",7,F)}; border-color: ${O("var(--oc-sdk-tone)",12)}; ${Uo} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${O("var(--oc-sdk-tone)",9,F)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${O("var(--oc-sdk-tone)",11,F)}; box-shadow: none; }

.oc-sdk-field-note { color: ${T}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${At}; }
.oc-sdk-input { border-radius: ${gt}; background: var(--oc-sdk-field-bg); color: ${ee}; ${kt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${T}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${C}, ${C}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${kt(O(L,26))} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${kt(m("status-error","red"))} }
.oc-sdk-input[data-mono="true"] { font-family: ${bt}; }

.oc-sdk-search-icon { color: ${T}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${X}; }
.oc-sdk-search-clear { border-radius: ${Ro}; color: ${T}; }
.oc-sdk-search-clear:hover { background: ${C}; color: ${L}; }

.oc-sdk-trigger { border-radius: ${gt}; background: var(--oc-sdk-raised-bg); color: ${ee}; ${Rt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${C}, ${C}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${z}, ${z}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${T}; }
.oc-sdk-trigger-chevron { color: ${T}; }
/* The app's dropdown light: lit top, hairline rings and a layered shadow. Its outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${ee}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${Ne}; background-clip: padding-box; color: ${ee}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${C}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${ht}; color: ${Ot}; }
.oc-sdk-option-check { color: ${L}; }
.oc-sdk-option[data-destructive="true"] { color: ${At}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${O(m("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${T}; }
.oc-sdk-popup-empty { color: ${T}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${V}; border-radius: 4px; color: ${L}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${O(L,60,V)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${V}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${F}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${X}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(16px); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${yo} }
.oc-sdk-check-desc { color: ${T}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${O(L,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${T}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${L}; }
.oc-sdk-tab[aria-selected="true"] { color: ${Ot}; background: ${ht}; border-color: ${V}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${ee}; background: var(--oc-sdk-raised-bg); ${Rt} }
.oc-sdk-tab-count { color: ${T}; }

.oc-sdk-badge { border-radius: 9999px; background: ${C}; color: ${T}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${O("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${C}; }
.oc-sdk-row[aria-selected="true"] { background: ${ht}; color: ${Ot}; }
.oc-sdk-row-lead { font-family: ${bt}; color: ${T}; }
.oc-sdk-row-sub { color: ${T}; }
.oc-sdk-row-meta { color: ${T}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${T}; }

.oc-sdk-empty-body { color: ${T}; }

.oc-sdk-spinner { color: ${T}; }
.oc-sdk-spinner-ring { border-color: ${V}; border-top-color: ${X}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${O("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${T}; }

.oc-sdk-separator { color: ${T}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${O(V,40)}; }

.oc-sdk-progress-label { color: ${T}; }
.oc-sdk-progress-track { border-radius: 9999px; background: ${V}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${X}); }

.oc-sdk-text a { color: ${xt}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${O(V,60)}; }
`,R=`
${je}
${cr}
${Io}`;var wo="oc-sdk-ui-style";var y=(e)=>{let r=document.getElementById(wo);if(r instanceof HTMLStyleElement){if(r.textContent!==e)r.textContent=e;return}ze(document);let n=document.createElement("style");n.id=wo,n.textContent=e,document.head.appendChild(n)},U=(e,r)=>{let n=document.createElement(e);if(r)n.className=r;return n},j=(e)=>{let r=U("button",e);return r.type="button",r},M=(e,r)=>{let n=r??"";if(e.textContent!==n)e.textContent=n},te=(e,r,n)=>{if(n===void 0||n===null||n==="")e.removeAttribute(r);else if(e.getAttribute(r)!==n)e.setAttribute(r,n)};var dr=()=>{let e=document.createElement("span");return e.className="oc-sdk-spinner-ring",e.setAttribute("aria-hidden","true"),e},oe=(e,r)=>{y(R);let n=r,p=j("oc-sdk oc-sdk-btn"),_=dr(),g=document.createElement("span");p.append(g),e.append(p);let N=()=>{if(p.dataset.variant=n.variant??"default",p.dataset.size=n.size??"default",p.disabled=Boolean(n.disabled)||Boolean(n.loading),p.dataset.loading=n.loading?"true":"false",p.setAttribute("aria-busy",n.loading?"true":"false"),n.loading&&_.parentNode!==p)p.prepend(_);else if(!n.loading&&_.parentNode===p)_.remove();M(g,n.label)},I=()=>{if(n.disabled||n.loading)return;n.onClick()};return p.addEventListener("click",I),N(),{update:(G)=>{n={...n,...G},N()},dispose:()=>{p.removeEventListener("click",I),p.remove()}}};var Ut=(e,r)=>{te(e,"data-tone",r&&r!=="neutral"?r:null)},vt=(e,r)=>{y(R);let n=r,p=U("span","oc-sdk oc-sdk-badge");e.append(p);let _=()=>{M(p,n.label),Ut(p,n.tone)};return _(),{update:(g)=>{n={...n,...g},_()},dispose:()=>{p.remove()}}};var He={name:"openchamber-magpie-usage",version:"0.1.0",description:"OpenChamber extension for Magpie gateway usage and quota",private:!0,type:"module",license:"MIT",openchamber:{apiVersion:1,engines:{openchamber:">=2.5.0"},contributes:{panel:{id:"magpie-usage",name:"Magpie Usage",icon:"bar-chart",entry:"panel/index.html"},service:{entry:"service/main.js",runtime:"host"}}},scripts:{build:"bun run build:panel && bun run build:service","build:panel":"openchamber-guest-bundle src/panel/main.ts panel/main.js","build:service":"openchamber-guest-bundle --node src/service/main.ts service/main.js",test:"bun test",typecheck:"tsc --noEmit",check:"bun run typecheck && bun test && bun run build"},devDependencies:{"@openchamber/sdk":"2.5.1","@types/bun":"^1.4.2",typescript:"^5.9.2"}};var Lo=(e)=>{let r;try{r=JSON.parse(e)}catch{return null}if(typeof r!=="object"||r===null)return null;let n=r;if(n.ok!==!0||typeof n.name!=="string"||typeof n.apiVersion!=="number")return null;return{ok:!0,name:n.name,apiVersion:n.apiVersion}};var It=Tt(),Po=document.querySelector("#root");if(!Po)throw Error("Missing #root");document.title=He.openchamber.contributes.panel.name;var k=(e,r,n)=>{let p=document.createElement(e);if(p.className=r,n!==void 0)p.textContent=n;return p},wt=(e)=>{let r=k("div","row"),n=k("span","row-value","—");return r.append(k("span","row-key",e),n),{node:r,value:n}},Go=k("header","header"),Do=k("div","heading");Do.append(k("h1","title",He.openchamber.contributes.panel.name),k("p","subtitle","OpenChamber extension scaffold"));Go.append(Do,k("span","version",`v${He.version}`));var Lt=k("section","card");Lt.append(k("div","label","Workbench"));var Ho=wt("Surface"),$o=wt("Locale"),Xo=wt("Project");Lt.append(Ho.node,$o.node,Xo.node);var Fo=k("section","card"),Bo=k("div","card-head"),Vo=k("span","badge-slot");Bo.append(k("div","label","Local service"),Vo);var ue=k("pre","output","No request yet."),jo=k("div","actions");Fo.append(Bo,k("p","muted","The panel cannot read files or call the gateway directly. Work that needs either belongs in the local service."),jo,ue);var _r=k("p","footer","Framework only: the host bridge and the service are wired. Usage data comes after the requirements are written.");Po.append(Go,Lt,Fo,_r);var re=vt(Vo,{label:"unknown",tone:"neutral"}),fr=(e)=>{if(!(e instanceof a))return e instanceof Error?e.message:String(e);switch(e.code){case"NO_SERVICE":case"NOT_GRANTED":return"The local service is not approved. Open Settings → Extensions and allow it, then retry.";case"DISABLED":return"The extension is paused in Settings → Extensions.";case"SERVICE_FAILED":return"The local service stopped. It restarts on the next request.";default:return`Service request failed: ${e.code}.`}},Sr=(e)=>{if(e==="ready")return"success";if(e==="failed")return"error";if(e==="starting")return"warning";return"neutral"},zo=async()=>{try{let{status:e}=await It.serviceStatus();re.update({label:e,tone:Sr(e)})}catch(e){if(e instanceof a&&e.code==="HOST_UNAVAILABLE"){re.update({label:"outside OpenChamber",tone:"neutral"});return}re.update({label:"unknown",tone:"neutral"})}},Mo=oe(jo,{label:"Check service",variant:"outline",size:"sm",onClick:()=>{Tr()}}),Ct=!1,Tr=async()=>{if(Ct)return;Ct=!0,Mo.update({loading:!0}),ue.textContent="Requesting /health…";try{let e=await It.serviceRequest({method:"GET",path:"/health"}),r=Lo(e.body);if(e.status===200&&r)ue.textContent=`HTTP ${e.status} · ${r.name} · API v${r.apiVersion}`,re.update({label:"ready",tone:"success"});else ue.textContent=`HTTP ${e.status} · ${e.body}`,re.update({label:"unexpected answer",tone:"error"})}catch(e){ue.textContent=fr(e),re.update({label:"unavailable",tone:"error"})}finally{Ct=!1,Mo.update({loading:!1}),zo()}},No=!0;It.onReady((e)=>{if(mt(e,document.documentElement),Ho.value.textContent=e.surface,$o.value.textContent=e.locale,Xo.value.textContent=e.directory??"No project",No)No=!1,zo()});})();
