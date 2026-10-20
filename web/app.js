import {API,uid,snapshot,saveGauge,saveReading,deleteGauge,deleteReading,nextPending,acceptOperation,rejectOperation,applyChanges,resolveConflict,backup,importBackup} from './db.js';
const $=id=>document.getElementById(id);let state={gauges:[],readings:[],outbox:[],cursor:0};let selected=null;let syncing=false;let lastError='';let syncTimer=null;let conflictSeq=null;let installPrompt=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=v=>Number(v).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2});
const when=v=>{try{return new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}catch{return v}};
const total=id=>state.readings.filter(r=>!id||r.gaugeId===id).reduce((sum,r)=>sum+r.mm,0);
const count=id=>state.readings.filter(r=>r.gaugeId===id).length;
function toast(text){const t=$('toast');t.textContent=text;t.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.add('hidden'),3600)}
function setBanner(html,isConflict=false){$('banner').innerHTML=html;$('banner').classList.remove('hidden');$('banner').classList.toggle('conflict',isConflict)}
function status(){
 const pend=state.outbox.length,conflicts=state.outbox.filter(p=>p.conflict);
 const label=syncing?'Sincronizando…':conflicts.length?'Conflito':!navigator.onLine?'Offline':lastError?(lastError==='not-updated'?'Servidor pendente':'Erro de conexão'):pend?'Pendente':'Sincronizado';
 const elem=$('connection');elem.textContent='● '+label;elem.className='status '+(conflicts.length||lastError?'status-bad':!navigator.onLine||pend?'status-warn':syncing?'status-neutral':'status-good');
 $('pendingInfo').textContent=pend?`${pend} alteração(ões) aguardando envio`:'Nenhuma alteração pendente';
 $('syncBtn').disabled=syncing;
 $('banner').classList.add('hidden');
 if(conflicts.length){setBanner(`<strong>${conflicts.length} conflito(s) de sincronização.</strong> Os registros locais continuam preservados. <button class="button button-soft" id="openConflict" type="button">Resolver agora</button>`,true)}
}
function render(){
 const app=$('app');const g=state.gauges.find(x=>x.id===selected);
 if(!g){
  selected=null;
  const cards=[...state.gauges].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(g=>{
   const latest=state.readings.filter(r=>r.gaugeId===g.id).sort((a,b)=>b.at.localeCompare(a.at))[0];
   const variants=['campo','serra','lago','pasto'];
   let hash=0;for(const ch of g.id)hash=(hash*31+ch.charCodeAt(0))>>>0;
   const illustration=variants[hash%variants.length];
   return `<button class="gauge gauge-list-card" type="button" data-gauge="${esc(g.id)}" aria-label="Abrir pluviômetro ${esc(g.name)}">
    <span class="gauge-illustration"><img src="/icons/pluviometro-${illustration}.svg" alt="" loading="lazy" width="88" height="88"></span>
    <span class="gauge-copy">
      <strong class="gauge-name">${esc(g.name)}</strong>
      <span class="place">⌖ ${esc(g.location||'Local não informado')}</span>
      <span class="rain">${fmt(total(g.id))} <small>mm</small></span>
      <span class="updated">◷ ${latest?'Última medição: '+esc(when(latest.at)):'Sem medições registradas'}</span>
    </span>
    <span class="gauge-chevron" aria-hidden="true">›</span>
   </button>`;
  }).join('');
  app.innerHTML=`<section class="hero hero-home">
    <div class="hero-info"><span class="hero-caption">Chuva acumulada</span><strong>${fmt(total())} <small>mm</small></strong></div>
    <svg class="rain-cloud" viewBox="0 0 120 95" fill="none" aria-hidden="true">
      <path d="M27 63a23 23 0 0 1 5-45 33 33 0 0 1 61 8 20 20 0 0 1 0 39H27Z" fill="#3F7B96" opacity=".64"/>
      <path d="m43 70-7 16m28-18-8 18m28-16-7 16" stroke="#75C7DE" stroke-width="5" stroke-linecap="round"/>
    </svg>
   </section>
   <div class="section gauge-heading"><h2>Pluviômetros</h2></div>
   ${cards?`<div class="gauges gauge-list">${cards}</div>`:'<div class="empty empty-home">Nenhum pluviômetro cadastrado.<br>Toque em <strong>+</strong> para começar.</div>'}`;

 }else{
  const rs=state.readings.filter(r=>r.gaugeId===selected).sort((a,b)=>b.at.localeCompare(a.at));
  app.innerHTML=`<button class="back" data-action="back">← Voltar</button><div class="detailhead"><div><h2 class="title">${esc(g.name)}</h2><p class="subtitle">${esc(g.location||'Local não informado')}</p></div><button class="button button-soft" data-action="editGauge">Editar</button></div><section class="hero"><span class="hero-caption">Chuva acumulada neste pluviômetro</span><strong>${fmt(total(g.id))} <small>mm</small></strong><span class="hero-caption">${rs.length} medições</span></section><div class="tile description"><strong>Descrição</strong><span class="muted">${esc(g.description||'Não informada')}</span></div><div class="section"><h2>Histórico de chuvas</h2><button class="button" data-action="newReading">+ Registrar</button></div>${rs.length?rs.map(r=>`<article class="reading"><div><strong>${fmt(r.mm)} mm</strong><time datetime="${esc(r.at)}">${esc(when(r.at))}</time>${r.notes?`<div class="notes">${esc(r.notes)}</div>`:''}</div><div class="actions"><button class="button button-soft" data-edit="${esc(r.id)}">Editar</button><button class="button button-danger" data-delete="${esc(r.id)}">Excluir</button></div></article>`).join(''):'<div class="empty">Nenhuma chuva registrada.<br>Toque em <strong>+ Registrar</strong>.</div>'}<div class="section"><button class="button button-danger" data-action="deleteGauge">Excluir pluviômetro</button></div>`;
 }
 $('fabNewGauge').hidden=Boolean(g);
 status();
}
async function refresh(){state=await snapshot();render()}
function editor(title,fields,submit){$('modalTitle').textContent=title;$('fields').innerHTML=fields;$('formError').classList.add('hidden');$('editorForm').onsubmit=async event=>{
 event.preventDefault();const save=$('saveDialog');save.disabled=true;try{await submit(new FormData(event.target));$('dialog').close();await refresh();scheduleSync();toast('Salvo neste dispositivo')}catch(e){$('formError').textContent=e.message;$('formError').classList.remove('hidden')}finally{save.disabled=false}
};$('dialog').showModal()}
function input(name,label,value='',max=160,required=false){return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" value="${esc(value)}" maxlength="${max}" ${required?'required':''}></div>`}
function editGauge(id){const g=state.gauges.find(x=>x.id===id);editor(g?'Editar pluviômetro':'Novo pluviômetro',input('name','Nome',g?.name||'',160,true)+input('location','Localização',g?.location||'',240)+`<div class="field"><label for="description">Descrição</label><textarea name="description" id="description" maxlength="2000">${esc(g?.description||'')}</textarea></div>`,async data=>{
 await saveGauge({id:g?.id,name:String(data.get('name')||''),location:String(data.get('location')||''),description:String(data.get('description')||'')});
})}
function editReading(id){const old=state.readings.find(r=>r.id===id);editor(old?'Editar medição':'Registrar chuva',`<div class="field"><label for="mm">Chuva (mm)</label><input id="mm" name="mm" type="number" min="0" max="10000" step="0.01" inputmode="decimal" value="${esc(old?.mm??'')}" placeholder="Ex.: 12,5" required></div><div class="field"><label for="notes">Observações (opcional)</label><textarea id="notes" name="notes" maxlength="2000">${esc(old?.notes||'')}</textarea></div><p class="small muted">📅 ${old?'Data original: '+esc(when(old.at)):'Data e hora registradas automaticamente ao salvar.'}</p>`,async data=>{
 const raw=String(data.get('mm')||'').replace(',','.');if(!raw.trim())throw Error('Informe a chuva em mm');
 await saveReading({id:old?.id,gaugeId:selected,mm:Number(raw),notes:String(data.get('notes')||'')});
})}
function syncStatusFromError(error){if(error.status===401||error.status===403)return 'not-updated';return error.message||'Falha desconhecida'}
async function api(method,path,payload){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{const res=await fetch(API+path,{method,headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,signal:controller.signal,cache:'no-store'});
  if(!res.ok){const e=Error(`Servidor HTTP ${res.status}`);e.status=res.status;throw e}
  return await res.json();
 }finally{clearTimeout(timer)}
}
async function sync(){if(syncing||!navigator.onLine)return;syncing=true;status();
 try{
  for(let i=0;i<5000;i++){
   const x=await nextPending();if(!x)break;if(x.conflict)break;
   const request={operations:[{op_id:x.opId,kind:x.kind,entity_id:x.entityId,action:x.action,base_version:x.baseVersion,data:x.payload}]};
   const response=await api('POST','/sync/push',request);
   const result=response.results?.[0];if(!result)throw Error('Resposta de sincronização inválida');
   if(result.status!=='accepted'){await rejectOperation(x,result.reason||'Conflito',result.server);break}
   await acceptOperation(x,Number(result.version));
  }
  // Nao aplicar registros remotos enquanto houver escrita local pendente;
  // preserva a ordem e mantem os conflitos para escolha do usuario.
  let local=await snapshot();
  if(!local.outbox.length){for(let i=0;i<1000;i++){
    const page=await api('GET',`/sync/pull?after=${local.cursor}&limit=200`);
    if(!Array.isArray(page.changes))throw Error('Resposta de leitura inválida');
    const applied=await applyChanges(page.changes);
    if(applied.blocked||!page.has_more||applied.cursor===local.cursor)break;
    local.cursor=applied.cursor;
  }}
  lastError='';
 }catch(e){lastError=syncStatusFromError(e)}finally{syncing=false;await refresh()}
}
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(sync,350)}
async function openConflict(){const x=state.outbox.find(p=>p.conflict);if(!x)return;conflictSeq=x.seq;
 $('conflictDetails').textContent=`Registro: ${x.kind==='gauge'?'Pluviômetro':'Medição'} • Motivo: ${x.conflict}`;
 $('keepLocalBtn').disabled=!x.serverPayload;$('keepServerBtn').disabled=!x.serverPayload;
 $('conflictDialog').showModal();
}
async function chooseConflict(keepLocal){try{await resolveConflict(conflictSeq,keepLocal);$('conflictDialog').close();await refresh();scheduleSync();toast('Conflito resolvido')}catch(e){toast(e.message)}}
$('app').addEventListener('click',async event=>{
 const b=event.target.closest('button');if(!b)return;
 try{
 if(b.dataset.gauge){selected=b.dataset.gauge;render();return}
 if(b.dataset.edit){editReading(b.dataset.edit);return}
 if(b.dataset.delete){if(confirm('Excluir esta medição? Ela ficará excluída também nos outros dispositivos quando sincronizar.')){await deleteReading(b.dataset.delete);await refresh();scheduleSync()}return}
 switch(b.dataset.action){
  case 'back':selected=null;render();break;
  case 'newGauge':editGauge();break;
  case 'editGauge':editGauge(selected);break;
  case 'newReading':editReading();break;
  case 'deleteGauge':if(confirm('Excluir este pluviômetro e suas medições em todos os aparelhos após sincronizar?')){await deleteGauge(selected);selected=null;await refresh();scheduleSync()}break;
 }
 }catch(e){toast(e.message)}
});
$('banner').addEventListener('click',event=>{if(event.target.id==='openConflict')openConflict()});
$('closeDialog').onclick=$('cancelDialog').onclick=()=>$('dialog').close();
$('fabNewGauge').onclick=()=>editGauge();
$('syncBtn').onclick=sync;
$('optionsBtn').onclick=()=>$('optionsDialog').showModal();
$('closeOptions').onclick=()=>$('optionsDialog').close();
$('closeConflict').onclick=()=>$('conflictDialog').close();
$('keepLocalBtn').onclick=()=>chooseConflict(true);
$('keepServerBtn').onclick=()=>chooseConflict(false);
$('exportBtn').onclick=async()=>{try{const b=await backup(),blob=new Blob([JSON.stringify(b,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`PLUV-BACKUP-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('Backup exportado')}catch(e){toast(e.message)}};
$('importBtn').onclick=()=>$('importFile').click();
$('importFile').onchange=async event=>{try{const file=event.target.files?.[0];if(!file)return;const data=JSON.parse(await file.text());if(!confirm('Importar registros ausentes deste backup? Os dados atuais serão preservados.'))return;const count=await importBackup(data);await refresh();scheduleSync();toast(`${count} registros importados`)}catch(e){toast(e.message)}finally{event.target.value=''}};
window.addEventListener('online',()=>{lastError='';status();sync()});
window.addEventListener('offline',status);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').hidden=false});
$('installBtn').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').hidden=true}};
async function init(){
 try{await refresh();if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  try{await navigator.serviceWorker.register('/sw.js')}catch(e){console.warn('Cache offline indisponível:',e)}
 }sync();setInterval(()=>{if(!document.hidden)sync()},60000)}
 catch(e){$('app').innerHTML=`<div class="empty">Não foi possível abrir o banco local do navegador: ${esc(e.message)}. Verifique se o navegador permite armazenamento local e não está no modo anônimo.</div>`;lastError=e.message;status()}
}
init();
