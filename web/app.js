import {API,uid,snapshot,saveGauge,saveReading,deleteGauge,deleteReading,nextPending,acceptOperation,rejectOperation,applyChanges,resolveConflict,backup,importBackup} from './db.js';
import {collectMapPoints,mapScreenHtml,mountReadingsMap,disposeReadingsMap} from './map.js';
const $=id=>document.getElementById(id);let state={gauges:[],readings:[],outbox:[],cursor:0};let selected=null;let syncing=false;let lastError='';let syncTimer=null;let conflictSeq=null;let installPrompt=null;let quickReadingHistory=false;let adminQuery='';let adminTab='gauges';let mapGauge='';let lastMobileGpsMessage='';
const asDay=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
let reportStart=asDay(new Date(new Date().getFullYear(),new Date().getMonth(),1));
let reportEnd=asDay(new Date());let reportGauge='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=v=>Number(v).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2});
const when=v=>{try{return new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}catch{return v}};
const total=id=>state.readings.filter(r=>!id||r.gaugeId===id).reduce((sum,r)=>sum+r.mm,0);
const count=id=>state.readings.filter(r=>r.gaugeId===id).length;
// O Android compilado e navegadores de celular mostram somente o registro rapido.
// No desktop permanecem cadastro, resumo, historico e administracao.
const isMobileMode=()=>Boolean(window.PLUV_ANDROID)
 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
;

// Navegacao real do navegador/PWA: o botao Voltar do Android volta ao dashboard.
const detailPrefix='#pluv/';
function gaugeFromUrl(){
 const hash=location.hash;
 if(!hash.startsWith(detailPrefix))return null;
 try{
  const id=decodeURIComponent(hash.slice(detailPrefix.length));
  return /^[0-9a-f-]{36}$/i.test(id)?id:null;
 }catch{return null}
}
function setupNavigation(){
 if(isMobileMode()){
  // O app movel tem uma tela so. Remove rotas antigas de detalhes.
  history.replaceState({pluvPage:'home'},'',location.pathname+location.search);
  selected=null;
  return;
 }
 const id=gaugeFromUrl();
 if(id&&!history.state?.pluvPage){
  const url=location.pathname+location.search;
  history.replaceState({pluvPage:'home'},'',url);
  history.pushState({pluvPage:'detail',id},'',detailPrefix+encodeURIComponent(id));
 }else if(!history.state?.pluvPage){
  history.replaceState({pluvPage:'home'},'',location.href);
 }
 selected=gaugeFromUrl();
}
function showGauge(id){
 if(selected===id)return;
 history.pushState({pluvPage:'detail',id},'',detailPrefix+encodeURIComponent(id));
 selected=id;
 render();
 window.scrollTo(0,0);
}
function showHome(){
 if(gaugeFromUrl()){
  if(history.state?.pluvPage==='detail')history.back();
  else{
   history.replaceState({pluvPage:'home'},'',location.pathname+location.search);
   selected=null;render();
  }
 }else{selected=null;render()}
 window.scrollTo(0,0);
}
window.addEventListener('popstate',()=>{
 if(quickReadingHistory){
  quickReadingHistory=false;
  if($('dialog').open)$('dialog').close();
 }
 selected=isMobileMode()?null:gaugeFromUrl();
 render();
 window.scrollTo(0,0);
});
// Chamado pelo invólucro Android ao usar a seta/gesto Voltar.
// Nenhum dado é apagado e os formulários abertos têm prioridade.
window.PLUV_NATIVE_BACK=()=>{
 const opened=['dialog','optionsDialog','conflictDialog']
  .map(id=>$(id)).find(element=>element?.open);
 if(opened){if(opened.id==='dialog'&&quickReadingHistory){closeEditor();return true}opened.close();return true}
 if(selected||gaugeFromUrl()){showHome();return true}
 return false;
};

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
function filterAdminRows(){
 const search=adminQuery.trim().toLocaleLowerCase('pt-BR');
 const rows=[...document.querySelectorAll('[data-admin-match]')];
 let visible=0;
 for(const row of rows){const matched=row.dataset.adminMatch.includes(search);row.hidden=!matched;if(matched)visible++}
 const empty=$('adminSearchEmpty');if(empty)empty.classList.toggle('hidden',visible!==0);
}
function reportData(){
 const gauges=[...state.gauges].filter(g=>!reportGauge||g.id===reportGauge).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 const known=new Map(gauges.map(g=>[g.id,g]));
 const readings=reportStart&&reportEnd&&reportStart<=reportEnd?state.readings.filter(r=>{
  if(!known.has(r.gaugeId))return false;
  const date=new Date(r.at);
  if(Number.isNaN(date.getTime()))return false;
  const day=asDay(date);
  return day>=reportStart&&day<=reportEnd;
 }).sort((a,b)=>b.at.localeCompare(a.at)):[];
 const totals=new Map(gauges.map(g=>[g.id,{gauge:g,mm:0,count:0}]));
 for(const r of readings){const row=totals.get(r.gaugeId);row.mm+=Number(r.mm);row.count++}
 return {gauges,readings,summary:[...totals.values()],totalMm:readings.reduce((sum,r)=>sum+Number(r.mm),0)};
}
function renderReport(){
 const {gauges,readings,summary,totalMm}=reportData();
 const allOptions=[...state.gauges].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 const invalid=!reportStart||!reportEnd||reportStart>reportEnd;
 const summaryRows=summary.map(({gauge,mm,count})=>`<tr>
  <td><strong>${esc(gauge.name)}</strong><small>${esc(gauge.location||'Sem localização')}</small></td>
  <td class="numeric">${count}</td><td class="numeric"><strong>${fmt(mm)} mm</strong></td>
 </tr>`).join('');
 const detailRows=readings.map(r=>{
  const gauge=state.gauges.find(g=>g.id===r.gaugeId);
  return `<tr><td>${esc(when(r.at))}</td><td>${esc(gauge?.name||'Não encontrado')}</td>
   <td class="numeric">${fmt(r.mm)} mm</td><td>${esc(r.notes||'—')}</td></tr>`;
 }).join('');
 return `<section class="report-screen" id="reportPrint">
   <div class="report-titlebar"><div><div class="admin-eyebrow">GERENCIAMENTO · RELATÓRIOS</div>
     <h2>Relatório de chuvas</h2><p>Consulte as medições por período e por pluviômetro.</p></div>
     <div class="report-export-actions"><button class="button button-soft" type="button" data-report-export>Exportar CSV</button>
      <button class="button" type="button" data-report-print>Imprimir / PDF</button></div>
   </div>
   <div class="report-filters">
     <div class="report-filter"><label for="reportStart">Data inicial</label><input id="reportStart" type="date" value="${esc(reportStart)}"></div>
     <div class="report-filter"><label for="reportEnd">Data final</label><input id="reportEnd" type="date" value="${esc(reportEnd)}"></div>
     <div class="report-filter report-filter-wide"><label for="reportGauge">Pluviômetro</label>
      <select id="reportGauge"><option value="">Todos os pluviômetros</option>
       ${allOptions.map(g=>`<option value="${esc(g.id)}" ${reportGauge===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}
      </select></div>
   </div>
   ${invalid?'<p class="report-warning" role="alert">Informe um período válido, com data inicial igual ou anterior à data final.</p>':''}
   <p class="report-period">Período: ${esc(reportStart.split('-').reverse().join('/'))} a ${esc(reportEnd.split('-').reverse().join('/'))} · Dados disponíveis neste dispositivo, inclusive alterações ainda não sincronizadas.</p>
   <div class="admin-stats report-stats">
    <div class="admin-stat"><span>Pluviômetros selecionados</span><strong>${gauges.length}</strong></div>
    <div class="admin-stat"><span>Medições no período</span><strong>${readings.length}</strong></div>
    <div class="admin-stat"><span>Soma das chuvas medidas</span><strong>${fmt(totalMm)} <small>mm</small></strong></div>
   </div>
   <section class="report-block"><h3>Resumo por pluviômetro</h3>
    <div class="report-table-wrap"><table class="report-table"><thead><tr><th>Pluviômetro / Localização</th><th class="numeric">Medições</th><th class="numeric">Total no período</th></tr></thead>
    <tbody>${summaryRows||'<tr><td colspan="3">Nenhum pluviômetro cadastrado.</td></tr>'}</tbody></table></div>
   </section>
   <section class="report-block"><h3>Medições detalhadas</h3>
    <div class="report-table-wrap"><table class="report-table"><thead><tr><th>Data e hora</th><th>Pluviômetro</th><th class="numeric">Chuva</th><th>Observações</th></tr></thead>
    <tbody>${detailRows||'<tr><td colspan="4">Nenhuma medição encontrada no período.</td></tr>'}</tbody></table></div>
   </section>
  </section>`;
}
function duplicateGauge(id){
 const gauge=state.gauges.find(g=>g.id===id);
 if(!gauge)throw Error('Pluviômetro não encontrado.');
 const suffix=' (cópia)';
 const name=gauge.name.slice(0,160-suffix.length)+suffix;
 editor('Duplicar pluviômetro',
  input('name','Nome',name,160,true)+input('location','Localização',gauge.location||'',240)+
  `<div class="field"><label for="description">Descrição</label><textarea name="description" id="description" maxlength="2000">${esc(gauge.description||'')}</textarea></div>
   <p class="small muted">Novo cadastro independente. As medições anteriores não serão copiadas.</p>`,
  async data=>{await saveGauge({name:String(data.get('name')||''),location:String(data.get('location')||''),description:String(data.get('description')||'')})}
 );
}
function csvCell(value){
 let text=String(value??'').replace(/\r\n?/g,'\n');
 if(/^\s*[=+\-@]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
function exportReport(){
 if(!reportStart||!reportEnd||reportStart>reportEnd){toast('Corrija as datas do relatório.');return}
 const {readings,summary}=reportData(),nameById=new Map(state.gauges.map(g=>[g.id,g]));
 const lines=[
  ['PLUV — RELATÓRIO DE CHUVAS'],
  ['Período',reportStart,reportEnd],
  [],['RESUMO POR PLUVIÔMETRO'],['Pluviômetro','Localização','Medições','Total (mm)'],
  ...summary.map(({gauge,count,mm})=>[gauge.name,gauge.location,count,String(mm).replace('.',',')]),
  [],['MEDIÇÕES DETALHADAS'],['Data e hora','Pluviômetro','Localização','Chuva (mm)','Observações'],
  ...readings.map(r=>[when(r.at),nameById.get(r.gaugeId)?.name||'',nameById.get(r.gaugeId)?.location||'',String(r.mm).replace('.',','),r.notes||''])
 ];
 const content='\ufeff'+lines.map(cols=>cols.map(csvCell).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;link.download=`PLUV_RELATORIO_${reportStart}_a_${reportEnd}.csv`;
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 toast('Relatório CSV exportado');
}

function render(){
 disposeReadingsMap();
 const app=$('app');const g=state.gauges.find(x=>x.id===selected);
 if(isMobileMode()){
  selected=null;
  if($('desktopNav'))$('desktopNav').hidden=true;
  document.documentElement.classList.add('pluv-mobile-mode');
  const cards=[...state.gauges].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(g=>{
   const variants=['campo','serra','lago','pasto'];
   let hash=0;for(const ch of g.id)hash=(hash*31+ch.charCodeAt(0))>>>0;
   const illustration=variants[hash%variants.length];
   return `<button class="quick-gauge-card" type="button" data-gauge="${esc(g.id)}" aria-label="Registrar chuva em ${esc(g.name)}">
     <span class="quick-gauge-art"><img src="/icons/pluviometro-${illustration}.svg" alt="" width="74" height="74"></span>
     <span class="quick-gauge-info"><strong>${esc(g.name)}</strong>
       ${g.location?`<span>${esc(g.location)}</span>`:''}
     </span>
     <span class="quick-gauge-plus" aria-hidden="true">+</span>
    </button>`;
  }).join('');
  app.innerHTML=`<section class="quick-home">
     <div class="quick-heading"><h2>Pluviômetros</h2><p>Toque em um pluviômetro para registrar a chuva.</p></div>
     ${cards?`<div class="quick-gauges">${cards}</div>`:'<div class="empty quick-empty">Nenhum pluviômetro cadastrado.<br>Cadastre os pluviômetros na versão para computador e sincronize este aparelho.</div>'}
   </section>`;
  $('fabNewGauge').hidden=true;
  status();
  return;
 }
 document.documentElement.classList.remove('pluv-mobile-mode');
 if($('desktopNav'))$('desktopNav').hidden=false;
 for(const btn of ($('desktopNav')?.querySelectorAll('[data-admin-section]')||[])){
  btn.classList.toggle('is-active',btn.dataset.adminSection===adminTab);
  btn.setAttribute('aria-current',btn.dataset.adminSection===adminTab?'page':'false');
 }
 if(adminTab==='reports'){
  app.innerHTML=renderReport();
  $('fabNewGauge').hidden=true;
  status();return;
 }
 if(adminTab==='map'){
  const points=collectMapPoints(state.gauges,state.readings,mapGauge);
  app.innerHTML=mapScreenHtml(state.gauges,state.readings,mapGauge);
  $('fabNewGauge').hidden=true;
  status();
  if(points.length)mountReadingsMap(points);
  return;
 }
 if(!g){
  selected=null;
  const sorted=[...state.gauges].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const rows=sorted.map(g=>{
    const latest=state.readings.filter(r=>r.gaugeId===g.id).sort((a,b)=>b.at.localeCompare(a.at))[0];
    const gps=gpsForGauge(g.id);
    const match=esc((g.name+' '+g.location).toLocaleLowerCase('pt-BR'));
    return `<div class="admin-row" data-admin-match="${match}">
      <div class="admin-gauge">
        <span class="admin-dot" aria-hidden="true">💧</span>
        <span class="admin-gauge-txt"><strong>${esc(g.name)}</strong><small>${esc(g.location||'Local não informado')}</small></span>
      </div>
      <div class="admin-rain"><strong>${fmt(total(g.id))} mm</strong><small>${count(g.id)} medição(ões)</small></div>
      <div class="admin-date">${latest?esc(when(latest.at)):'Sem registro'}</div>
      <div class="admin-actions">
        <button class="button button-soft" data-gauge="${esc(g.id)}" type="button">Histórico</button>
        <button class="button button-soft" data-admin-edit="${esc(g.id)}" type="button">Editar</button>
        <button class="button button-soft" data-admin-duplicate="${esc(g.id)}" type="button">Duplicar</button>
        <button class="button button-danger" data-admin-delete="${esc(g.id)}" type="button">Excluir</button>
      </div>
      <div class="admin-gps">${gps?`<span class="admin-gps-value">${esc(gpsLabel(gps))}</span>
       <a class="admin-map-link" href="${esc(gpsMapUrl(gps))}" target="_blank" rel="noopener noreferrer" title="Abrir a coordenada no Google Maps">Ver mapa ↗</a>`:
       '<span class="muted">Sem GPS</span>'}</div>
    </div>`;
  }).join('');
  app.innerHTML=`<section class="admin-head">
    <div><span class="admin-eyebrow">PAINEL DE GERENCIAMENTO</span><h2>Pluviômetros</h2>
    <p>Cadastre os pluviômetros, acompanhe as medições e veja as coordenadas capturadas pelos celulares. GPS corresponde ao local do primeiro registro autorizado.</p></div>
    <button class="button admin-add" data-action="newGauge" type="button">+ Novo pluviômetro</button>
   </section>
   <section class="admin-stats" aria-label="Resumo geral">
    <div class="admin-stat"><span>Pluviômetros cadastrados</span><strong>${state.gauges.length}</strong></div>
    <div class="admin-stat"><span>Medições registradas</span><strong>${state.readings.length}</strong></div>
    <div class="admin-stat"><span>Chuva acumulada</span><strong>${fmt(total())} <small>mm</small></strong></div>
   </section>
   <section class="admin-list-head"><h3>Cadastro e histórico</h3>
    <input id="adminSearch" type="search" placeholder="Pesquisar nome ou localização" aria-label="Pesquisar pluviômetros" value="${esc(adminQuery)}" autocomplete="off">
   </section>
   ${rows?`<div class="admin-table"><div class="admin-table-head"><span>PLUVIÔMETRO</span><span>CHUVA</span><span>ÚLTIMA MEDIÇÃO</span><span>AÇÕES</span><span>GPS / MAPA</span></div>${rows}</div><div id="adminSearchEmpty" class="empty hidden">Nenhum pluviômetro corresponde à pesquisa.</div>`:'<div class="empty">Nenhum pluviômetro cadastrado. Clique em <strong>+ Novo pluviômetro</strong>.</div>'}`;
  filterAdminRows();

 }else{
  const rs=state.readings.filter(r=>r.gaugeId===selected).sort((a,b)=>b.at.localeCompare(a.at));
  const countLabel=rs.length===1?'1 medição registrada':rs.length+' medições registradas';
  const gps=gpsForGauge(g.id);
  app.innerHTML=`<section class="hero hero-detail" aria-label="Resumo do pluviômetro">
   <div class="detail-hero-toolbar">
     <button class="detail-hero-icon" type="button" data-action="back" aria-label="Voltar aos pluviômetros" title="Voltar">←</button>
     <span class="detail-hero-overline">PLUVIÔMETRO</span>
     <button class="detail-hero-icon" type="button" data-action="editGauge" aria-label="Editar pluviômetro" title="Editar pluviômetro">✎</button>
   </div>
   <h2 class="detail-hero-name">${esc(g.name)}</h2>
   ${g.location?`<div class="detail-hero-location">⌖ ${esc(g.location)}</div>`:''}
   <div class="detail-hero-divider"></div>
   <div class="detail-hero-label">Chuva acumulada</div>
   <strong class="detail-hero-rain">${fmt(total(g.id))} <small>mm</small></strong>
   <div class="detail-hero-count">${countLabel}</div>
   ${gps?`<div class="detail-gps"><span>Primeira coordenada GPS: ${esc(gpsLabel(gps))}</span>
      <a href="${esc(gpsMapUrl(gps))}" target="_blank" rel="noopener noreferrer">Abrir no mapa ↗</a></div>`:''}
  </section>
  <button class="button button-register-rain" type="button" data-action="newReading" aria-label="Registrar chuva neste pluviômetro"><span class="register-plus" aria-hidden="true">+</span><span>Registrar chuva</span><span class="register-chevron" aria-hidden="true">›</span></button>
  <div class="section detail-history-title"><h2>Histórico de chuvas</h2></div>
  ${rs.length?rs.map(r=>`<article class="reading"><div><strong>${fmt(r.mm)} mm</strong><time datetime="${esc(r.at)}">${esc(when(r.at))}</time>${r.notes?`<div class="notes">${esc(r.notes)}</div>`:''}</div><div class="actions"><button class="button button-soft" data-edit="${esc(r.id)}">Editar</button><button class="button button-danger" data-delete="${esc(r.id)}">Excluir</button></div></article>`).join(''):'<div class="empty detail-empty">Nenhuma chuva registrada.<br>Use <strong>Registrar chuva</strong> para começar.</div>'}
  <div class="detail-bottom-actions"><button class="detail-delete" type="button" data-action="deleteGauge">Excluir pluviômetro</button></div>`;

 }
 $('fabNewGauge').hidden=true;
 status();
}
async function refresh(){state=await snapshot();render()}
function editor(title,fields,submit){$('modalTitle').textContent=title;$('fields').innerHTML=fields;$('formError').classList.add('hidden');$('editorForm').onsubmit=async event=>{
 event.preventDefault();const save=$('saveDialog');save.disabled=true;try{await submit(new FormData(event.target));closeEditor();await refresh();scheduleSync();toast(isMobileMode()&&lastMobileGpsMessage?lastMobileGpsMessage:isMobileMode()?'Chuva registrada neste dispositivo':'Salvo neste dispositivo');lastMobileGpsMessage=''}catch(e){$('formError').textContent=e.message;$('formError').classList.remove('hidden')}finally{save.disabled=false}
};$('dialog').showModal()}
function closeEditor(){
 if($('dialog').open)$('dialog').close();
 if(quickReadingHistory){
  quickReadingHistory=false;
  if(history.state?.pluvPage==='quickReading')history.back();
 }
}
// GPS somente durante registro iniciado pelo usuario, sem rastreamento continuo.
// Na primeira vez o sistema solicita permissao; falha/recusa nao impede gravar chuva.
// GPS solicitado apenas ao abrir o formulario de registro. A autorizacao e do
// sistema operacional/navegador; nunca acompanha o usuario em segundo plano.
function captureReadingGps(update=()=>{}){
 if(!window.isSecureContext){
  update('GPS indisponível: abra o PLUV pelo endereço HTTPS.');
  return Promise.resolve(null);
 }
 if(!navigator.geolocation){
  update('GPS não disponível neste navegador/dispositivo.');
  return Promise.resolve(null);
 }
 update('Obtendo localização do celular… Na primeira vez, permita o acesso quando solicitado.');
 return new Promise(resolve=>{
  let done=false;
  const finish=(coords,message)=>{
   if(done)return;
   done=true;clearTimeout(timer);
   update(message);
   resolve(coords);
  };
  // A versao anterior encerrava o GPS cedo demais, inclusive durante o prompt.
  const timer=setTimeout(()=>finish(null,'GPS demorou para responder. Chuva poderá ser salva sem coordenadas.'),28000);
  try{
   navigator.geolocation.getCurrentPosition(position=>{
    const {latitude,longitude,accuracy}=position.coords;
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||
      Math.abs(latitude)>90||Math.abs(longitude)>180){
     finish(null,'O aparelho retornou coordenadas inválidas.');return;
    }
    const gps={latitude:Number(latitude.toFixed(6)),longitude:Number(longitude.toFixed(6)),
     accuracyM:Number.isFinite(accuracy)?Math.max(0,Number(accuracy.toFixed(2))):null};
    const quality=gps.accuracyM===null?'precisão não informada':
     'precisão aproximada '+Math.round(gps.accuracyM)+' m';
    finish(gps,'GPS obtido ✓ ('+quality+'). A localização será salva com a medição.');
   },error=>{
    const reason=error?.code===1?'GPS negado. Permita o acesso à localização nas configurações do app.':
     error?.code===2?'Não foi possível determinar a localização. Confira o GPS do celular.':
     'GPS demorou para responder. Você ainda pode registrar a chuva.';
    finish(null,reason);
   },{enableHighAccuracy:true,timeout:22000,maximumAge:120000});
  }catch{finish(null,'Falha ao solicitar GPS. Chuva poderá ser registrada sem localização.')}
 });
}
function gpsForGauge(id){
 const readings=state.readings.filter(r=>r.gaugeId===id&&r.latitude!=null&&r.longitude!=null&&
  Number.isFinite(Number(r.latitude))&&Number.isFinite(Number(r.longitude)));
 return readings.sort((a,b)=>a.at.localeCompare(b.at))[0]||null;
}
function gpsLabel(r){return Number(r.latitude).toFixed(6)+', '+Number(r.longitude).toFixed(6)}
function gpsMapUrl(r){
 return 'https://www.google.com/maps?q='+encodeURIComponent(Number(r.latitude).toFixed(6)+','+Number(r.longitude).toFixed(6));
}

function quickReading(gaugeId){
 const gauge=state.gauges.find(g=>g.id===gaugeId);
 if(!gauge){toast('Pluviômetro não encontrado. Sincronize novamente.');return}
 const gpsPromise=captureReadingGps(message=>{
  const el=$('quickGpsStatus');if(el)el.textContent=message;
 });
 editor('Registrar chuva — '+gauge.name,
  '<div class="field quick-mm-field"><label for="mm">Chuva medida (mm)</label>'+
  '<input id="mm" name="mm" type="number" inputmode="decimal" min="0" max="10000" step="0.01" placeholder="Ex.: 12,5" required autofocus></div>'+
  '<p class="small muted">Data e hora automáticas. GPS é solicitado ao registrar chuva, com autorização do celular.</p>'+
  '<p class="quick-gps-status" id="quickGpsStatus" role="status">Obtendo localização do celular…</p>',
  async data=>{
   const raw=String(data.get('mm')??'').trim().replace(',','.');
   if(!raw||!Number.isFinite(Number(raw))||Number(raw)<0||Number(raw)>10000)throw Error('Informe a quantidade de chuva em mm.');
   const pending=$('quickGpsStatus');
   if(pending)pending.textContent='Verificando GPS antes de salvar a chuva…';
   const gps=await gpsPromise;
   await saveReading({gaugeId,mm:Number(raw),notes:'',...(gps||{})});
   lastMobileGpsMessage=gps?'Chuva registrada com GPS ✓':'Chuva registrada sem GPS. Confira a permissão de localização.';
  }
 );
 quickReadingHistory=true;
 history.pushState({pluvPage:'quickReading'},'',location.pathname+location.search+'#registrar');
}
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
 if(b.dataset.gauge){if(isMobileMode())quickReading(b.dataset.gauge);else showGauge(b.dataset.gauge);return}
 if(!isMobileMode()&&b.dataset.adminEdit){editGauge(b.dataset.adminEdit);return}
 if(!isMobileMode()&&b.dataset.adminDuplicate){duplicateGauge(b.dataset.adminDuplicate);return}
 if(!isMobileMode()&&b.dataset.adminDelete){
  if(confirm('Excluir este pluviômetro e suas medições nos dispositivos sincronizados?')){
   await deleteGauge(b.dataset.adminDelete);await refresh();scheduleSync();
  }
  return
 }
 if(b.dataset.edit){editReading(b.dataset.edit);return}
 if(b.dataset.delete){if(confirm('Excluir esta medição? Ela ficará excluída também nos outros dispositivos quando sincronizar.')){await deleteReading(b.dataset.delete);await refresh();scheduleSync()}return}
 switch(b.dataset.action){
  case 'back':showHome();break;
  case 'newGauge':editGauge();break;
  case 'editGauge':editGauge(selected);break;
  case 'newReading':editReading();break;
  case 'deleteGauge':if(confirm('Excluir este pluviômetro e suas medições em todos os aparelhos após sincronizar?')){await deleteGauge(selected);showHome();await refresh();scheduleSync()}break;
 }
 }catch(e){toast(e.message)}
});
$('app').addEventListener('input',event=>{
 if(event.target?.id==='adminSearch'){adminQuery=event.target.value;filterAdminRows()}
});
$('app').addEventListener('change',event=>{
 if(isMobileMode())return;
 if(event.target?.id==='mapGauge'){
  mapGauge=event.target.value;render();return;
 }
 if(!['reportStart','reportEnd','reportGauge'].includes(event.target?.id))return;
 if(event.target.id==='reportStart')reportStart=event.target.value;
 if(event.target.id==='reportEnd')reportEnd=event.target.value;
 if(event.target.id==='reportGauge')reportGauge=event.target.value;
 render();
});
$('desktopNav').addEventListener('click',event=>{
 const button=event.target.closest('[data-admin-section]');
 if(!button||isMobileMode())return;
 const target=button.dataset.adminSection;
 if(!['gauges','reports','map'].includes(target))return;
 adminTab=target;
 if(selected){
  selected=null;
  history.replaceState({pluvPage:'home'},'',location.pathname+location.search);
 }
 render();window.scrollTo(0,0);
});
$('app').addEventListener('click',event=>{
 const button=event.target.closest('button');
 if(!button||isMobileMode())return;
 if(button.hasAttribute('data-report-export'))exportReport();
 if(button.hasAttribute('data-report-print')){
  if(!reportStart||!reportEnd||reportStart>reportEnd){toast('Corrija as datas do relatório.');return}
  window.print();
 }
});
$('banner').addEventListener('click',event=>{if(event.target.id==='openConflict')openConflict()});
$('closeDialog').onclick=$('cancelDialog').onclick=closeEditor;
$('dialog').addEventListener('cancel',event=>{
 if(quickReadingHistory){event.preventDefault();closeEditor()}
});
$('fabNewGauge').onclick=()=>editGauge();
$('refreshFilesBtn').onclick=async()=>{
 const button=$('refreshFilesBtn');
 if(!navigator.onLine){toast('Conecte-se à internet para atualizar a interface.');return}
 button.disabled=true;
 try{
  const health=await fetch('/health',{cache:'no-store'});
  if(!health.ok)throw Error('Servidor indisponível');
  // Remove APENAS arquivos temporarios do PWA; nunca toca no IndexedDB.
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('pluv-pwa-')).map(name=>caches.delete(name)));
  if('serviceWorker'in navigator){
   const reg=await navigator.serviceWorker.getRegistration();
   if(reg){
    await reg.update();
    reg.waiting?.postMessage('SKIP_WAITING');
   }
  }
  location.reload();
 }catch(e){toast('Não foi possível atualizar. Tente novamente com internet.');button.disabled=false}
};
$('syncBtn').onclick=sync;
$('optionsBtn').onclick=()=>$('optionsDialog').showModal();
$('closeOptions').onclick=()=>$('optionsDialog').close();
$('closeConflict').onclick=()=>$('conflictDialog').close();
$('keepLocalBtn').onclick=()=>chooseConflict(true);
$('keepServerBtn').onclick=()=>chooseConflict(false);
$('exportBtn').onclick=async()=>{try{
 const data=JSON.stringify(await backup(),null,2);
 if(window.PLUV_ANDROID?.saveBackup){
  window.PLUV_ANDROID.saveBackup(data);
  toast('Escolha onde salvar o backup');
 }else{
  const blob=new Blob([data],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;
  a.download=`PLUV-BACKUP-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('Backup exportado');
 }
}catch(e){toast(e.message)}};
$('importBtn').onclick=()=>$('importFile').click();
$('importFile').onchange=async event=>{try{const file=event.target.files?.[0];if(!file)return;const data=JSON.parse(await file.text());if(!confirm('Importar registros ausentes deste backup? Os dados atuais serão preservados.'))return;const count=await importBackup(data);await refresh();scheduleSync();toast(`${count} registros importados`)}catch(e){toast(e.message)}finally{event.target.value=''}};
window.addEventListener('online',()=>{lastError='';status();sync()});
window.addEventListener('offline',status);
let previousMobileMode=isMobileMode();
window.addEventListener('resize',()=>{
 const next=isMobileMode();
 if(next!==previousMobileMode){
  previousMobileMode=next;
  if(next)setupNavigation();
  render();
 }
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').hidden=false});
$('installBtn').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').hidden=true}};
async function init(){
 try{setupNavigation();await refresh();if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  try{
   const previous=navigator.serviceWorker.controller;
   navigator.serviceWorker.addEventListener('controllerchange',()=>{
    // Apos ativar nova versao, carrega os arquivos atualizados sem apagar dados.
    if(previous&&navigator.onLine&&!$('dialog').open&&!$('optionsDialog').open&&!$('conflictDialog').open)location.reload();
   },{once:true});
   const reg=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
   reg.update().catch(()=>{});
  }catch(e){console.warn('Cache offline indisponível:',e)}
 }sync();setInterval(()=>{if(!document.hidden)sync()},60000)}
 catch(e){$('app').innerHTML=`<div class="empty">Não foi possível abrir o banco local do navegador: ${esc(e.message)}. Verifique se o navegador permite armazenamento local e não está no modo anônimo.</div>`;lastError=e.message;status()}
}
init();
