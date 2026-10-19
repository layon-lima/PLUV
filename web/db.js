// Banco local do PLUV. Cada mudanca e registrada na mesma transacao que atualiza a tela.
const NAME='pluv-offline-pwa';
export const API=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?'https://pluv.fazendanovohorizonte.com':location.origin;
let dbPromise;
export function uid(){return crypto.randomUUID()}
function req(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function open(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const r=indexedDB.open(NAME,1);
  r.onupgradeneeded=()=>{
   const d=r.result;
   d.createObjectStore('gauges',{keyPath:'id'});
   const readings=d.createObjectStore('readings',{keyPath:'id'});readings.createIndex('gaugeId','gaugeId');
   const outbox=d.createObjectStore('outbox',{keyPath:'seq',autoIncrement:true});outbox.createIndex('entityId','entityId');
   d.createObjectStore('meta',{keyPath:'key'});
  };
  r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)};
  r.onerror=()=>reject(r.error);
 });
 return dbPromise;
}
async function run(names,mode,cb){
 const d=await open();const tx=d.transaction(names,mode);
 let resolveDone,rejectDone;
 const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject});
 tx.oncomplete=()=>resolveDone();tx.onabort=()=>rejectDone(tx.error||Error('Gravacao cancelada'));tx.onerror=()=>{};
 try{const result=await cb(tx);await done;return result}catch(e){try{tx.abort()}catch{};throw e}
}
const store=(tx,name)=>tx.objectStore(name);
export async function snapshot(){return run(['gauges','readings','outbox','meta'],'readonly',async tx=>{
 const [gauges,readings,outbox,meta]=await Promise.all([
  req(store(tx,'gauges').getAll()),req(store(tx,'readings').getAll()),
  req(store(tx,'outbox').getAll()),req(store(tx,'meta').get('cursor'))
 ]);
 return {gauges:gauges.filter(g=>!g.deleted),readings:readings.filter(r=>!r.deleted),outbox,cursor:meta?.value||0};
})}
function op(id,kind,action,version,data){return {opId:uid(),entityId:id,kind,action,baseVersion:version,payload:data,conflict:'',serverPayload:null,createdAt:Date.now()}}
async function pendingFor(tx,id){return req(store(tx,'outbox').index('entityId').getAll(id))}
export async function saveGauge(data){return run(['gauges','outbox'],'readwrite',async tx=>{
 const gauges=store(tx,'gauges'),out=store(tx,'outbox');const id=data.id||uid();
 const [before,pending]=await Promise.all([req(gauges.get(id)),pendingFor(tx,id)]);
 if(before?.deleted)throw Error('Pluviometro excluido; nao e possivel editar');
 const g={id,name:data.name.trim(),location:data.location.trim(),description:data.description.trim(),version:before?.version||0,deleted:false};
 if(!g.name||g.name.length>160||g.location.length>240||g.description.length>2000)throw Error('Verifique os tamanhos dos campos');
 await Promise.all([req(gauges.put(g)),req(out.add(op(id,'gauge','upsert',g.version+pending.length,{name:g.name,location:g.location,description:g.description})))]);
 return id;
})}
export async function saveReading(data){return run(['gauges','readings','outbox'],'readwrite',async tx=>{
 const readings=store(tx,'readings'),out=store(tx,'outbox');
 const gauge=await req(store(tx,'gauges').get(data.gaugeId));if(!gauge||gauge.deleted)throw Error('Pluviometro nao encontrado');
 const id=data.id||uid(),before=await req(readings.get(id)),pending=await pendingFor(tx,id);
 if(before?.deleted)throw Error('Registro excluido; nao e possivel editar');
 if(before&&before.gaugeId!==data.gaugeId)throw Error('Registro pertence a outro pluviometro');
 const mm=Math.round((Number(data.mm)+Number.EPSILON)*100)/100;
 if(!Number.isFinite(mm)||mm<0||mm>10000||data.notes.length>2000)throw Error('Medição invalida');
 const r={id,gaugeId:data.gaugeId,mm,at:before?.at||new Date().toISOString(),notes:data.notes.trim(),version:before?.version||0,deleted:false};
 await Promise.all([req(readings.put(r)),req(out.add(op(id,'reading','upsert',r.version+pending.length,{gauge_id:r.gaugeId,amount_mm:r.mm,observed_at:r.at,notes:r.notes})))]);
 return id;
})}
export async function deleteReading(id){return run(['readings','outbox'],'readwrite',async tx=>{
 const readings=store(tx,'readings'),out=store(tx,'outbox'),old=await req(readings.get(id));if(!old||old.deleted)return;
 const p=await pendingFor(tx,id);
 await Promise.all([req(readings.put({...old,deleted:true})),req(out.add(op(id,'reading','delete',old.version+p.length,{})))]);
})}
export async function deleteGauge(id){return run(['gauges','readings','outbox'],'readwrite',async tx=>{
 const gauges=store(tx,'gauges'),readings=store(tx,'readings'),out=store(tx,'outbox');
 const gauge=await req(gauges.get(id));if(!gauge||gauge.deleted)return;
 const rs=(await req(readings.index('gaugeId').getAll(id))).filter(r=>!r.deleted);
 const pending=await req(out.getAll());
 const counts={};for(const x of pending)counts[x.entityId]=(counts[x.entityId]||0)+1;
 // Excluir leituras antes do pluviometro para respeitar dependencias na API.
 for(const r of rs){await req(readings.put({...r,deleted:true}));await req(out.add(op(r.id,'reading','delete',r.version+(counts[r.id]||0),{})))}
 await req(gauges.put({...gauge,deleted:true}));await req(out.add(op(id,'gauge','delete',gauge.version+(counts[id]||0),{})));
})}
export async function nextPending(){return run(['outbox'],'readonly',async tx=>{const a=await req(store(tx,'outbox').getAll());return a[0]||null})}
export async function acceptOperation(item,version){return run(['gauges','readings','outbox'],'readwrite',async tx=>{
 const out=store(tx,'outbox');const current=await req(out.get(item.seq));if(!current||current.opId!==item.opId)return;
 const dest=store(tx,item.kind==='gauge'?'gauges':'readings');const local=await req(dest.get(item.entityId));
 if(local&&local.version<version)await req(dest.put({...local,version}));
 await req(out.delete(item.seq));
})}
export async function rejectOperation(item,reason,server){return run(['outbox'],'readwrite',async tx=>{
 const out=store(tx,'outbox'),current=await req(out.get(item.seq));if(current&&current.opId===item.opId)
  await req(out.put({...current,conflict:reason||'Conflito desconhecido',serverPayload:server||null}));
})}
export async function applyChanges(changes){return run(['gauges','readings','outbox','meta'],'readwrite',async tx=>{
 const out=store(tx,'outbox'),pending=await req(out.getAll());const blocked=new Set(pending.map(p=>p.entityId));
 const meta=store(tx,'meta'),cursorRec=await req(meta.get('cursor'));let cursor=cursorRec?.value||0;let conflict=false;
 for(const c of changes){if(blocked.has(c.entity_id)){conflict=true;break}
  const dest=store(tx,c.kind==='gauge'?'gauges':'readings'),before=await req(dest.get(c.entity_id));const p=c.data;
  if(!before||before.version<Number(p.version)){
   const val=c.kind==='gauge'?{id:c.entity_id,name:p.name,location:p.location||'',description:p.description||'',version:Number(p.version),deleted:p.deleted_at!==null}
    :{id:c.entity_id,gaugeId:p.gauge_id,mm:Number(p.amount_mm),at:p.observed_at,notes:p.notes||'',version:Number(p.version),deleted:p.deleted_at!==null};
   await req(dest.put(val));
  }
  cursor=c.cursor;
 }
 await req(meta.put({key:'cursor',value:cursor}));return {cursor,blocked:conflict};
})}
export async function resolveConflict(seq,keepLocal){return run(['gauges','readings','outbox'],'readwrite',async tx=>{
 const out=store(tx,'outbox'),all=await req(out.getAll());const x=all.find(p=>p.seq===seq);
 if(!x||!x.conflict)throw Error('Conflito nao encontrado');
 if(!x.serverPayload)throw Error('Versao do servidor indisponivel. Seu dado continua protegido.');
 const server=x.serverPayload;const version=Number(server.version);const deleted=server.deleted_at!==null;
 const dest=store(tx,x.kind==='gauge'?'gauges':'readings'),local=await req(dest.get(x.entityId));
 if(keepLocal&&deleted&&!local?.deleted)throw Error('Registro excluido no servidor. Para evitar perda, mantenha a pendencia e solicite suporte.');
 // A escolha do usuario descarta somente as operacoes pendentes deste registro.
 for(const p of all.filter(p=>p.entityId===x.entityId))await req(out.delete(p.seq));
 if(keepLocal){if(!local)throw Error('Registro local nao encontrado');await req(dest.put({...local,version}));
  const data=x.kind==='gauge'?{name:local.name,location:local.location,description:local.description}:{gauge_id:local.gaugeId,amount_mm:local.mm,observed_at:local.at,notes:local.notes};
  await req(out.add(op(local.id,x.kind,local.deleted?'delete':'upsert',version,local.deleted?{}:data)));
 }else{
  const val=x.kind==='gauge'?{id:x.entityId,name:server.name,location:server.location||'',description:server.description||'',version,deleted}
  :{id:x.entityId,gaugeId:server.gauge_id,mm:Number(server.amount_mm),at:server.observed_at,notes:server.notes||'',version,deleted};
  await req(dest.put(val));
 }
})}
export async function backup(){return run(['gauges','readings','outbox','meta'],'readonly',async tx=>{
 const data={kind:'pluv-pwa-backup',version:1,createdAt:new Date().toISOString()};
 for(const type of ['gauges','readings','outbox','meta'])data[type]=await req(store(tx,type).getAll());
 return data;
})}
export async function importBackup(data){
 if(!data||data.kind!=='pluv-pwa-backup'||data.version!==1||!Array.isArray(data.gauges)||!Array.isArray(data.readings))throw Error('Arquivo nao e um backup PLUV valido');
 if(data.gauges.length>50000||data.readings.length>250000)throw Error('Arquivo grande demais');
 // Somente registros locais ausentes: ao importar, reencaminhar como registros novos (versao base 0).
 return run(['gauges','readings','outbox'],'readwrite',async tx=>{
  const gauges=store(tx,'gauges'),readings=store(tx,'readings'),out=store(tx,'outbox');let count=0;
  for(const g of data.gauges){if(!g||typeof g.id!=='string'||typeof g.name!=='string'||g.deleted)continue;
   if(!(await req(gauges.get(g.id)))){const clean={id:g.id,name:g.name.slice(0,160),location:String(g.location||'').slice(0,240),description:String(g.description||'').slice(0,2000),version:0,deleted:false};await req(gauges.put(clean));await req(out.add(op(clean.id,'gauge','upsert',0,{name:clean.name,location:clean.location,description:clean.description})));count++}
  }
  for(const r of data.readings){if(!r||typeof r.id!=='string'||typeof r.gaugeId!=='string'||r.deleted)continue;
   if(!(await req(readings.get(r.id)))){const parent=await req(gauges.get(r.gaugeId));if(!parent||parent.deleted)continue;
    const mm=Number(r.mm);if(!Number.isFinite(mm)||mm<0||mm>10000)continue;
    const clean={id:r.id,gaugeId:r.gaugeId,mm:Math.round(mm*100)/100,at:String(r.at||new Date().toISOString()),notes:String(r.notes||'').slice(0,2000),version:0,deleted:false};
    await req(readings.put(clean));await req(out.add(op(clean.id,'reading','upsert',0,{gauge_id:clean.gaugeId,amount_mm:clean.mm,observed_at:clean.at,notes:clean.notes})));count++}
  }
  return count;
 });
}
