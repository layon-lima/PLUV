// PLUV Desktop: MapLibre GL + OpenFreeMap (mapas vetoriais sem chave).
// O mapa so carrega no desktop e nao interfere no salvamento offline.
const MAPLIBRE_CDN='https://cdn.jsdelivr.net/npm/maplibre-gl@6.15.0/dist/';
const FREE_STYLE='https://tiles.openfreemap.org/styles/liberty';
let mapLibraryPromise=null;
let activeMap=null;
let requestSeq=0;

function googleSatelliteUrl(latitude,longitude,zoom=18){
 const center=Number(latitude).toFixed(6)+','+Number(longitude).toFixed(6);
 return 'https://www.google.com/maps/@?api=1&map_action=map&center='+
  encodeURIComponent(center)+'&zoom='+zoom+'&basemap=satellite';
}

function ensureMapLibre(){
 if(mapLibraryPromise)return mapLibraryPromise;
 mapLibraryPromise=(async()=>{
  if(!document.getElementById('maplibreStyles')){
   const sheet=document.createElement('link');
   sheet.id='maplibreStyles';
   sheet.rel='stylesheet';
   sheet.href=MAPLIBRE_CDN+'maplibre-gl.css';
   const cssReady=new Promise((resolve,reject)=>{
    sheet.onload=()=>resolve();
    sheet.onerror=()=>reject(Error('Falha ao carregar estilos do mapa'));
    setTimeout(()=>reject(Error('A folha de estilos do mapa demorou a carregar')),15000);
   });
   document.head.appendChild(sheet);
   // O JS e os estilos precisam estar prontos antes de exibir o mapa.
   const [mod]=await Promise.all([
    import(MAPLIBRE_CDN+'maplibre-gl.mjs'),
    cssReady
   ]);
   return mod;
  }
  return await import(MAPLIBRE_CDN+'maplibre-gl.mjs');
 })().catch(error=>{mapLibraryPromise=null;throw error});
 return mapLibraryPromise;
}

export function disposeReadingsMap(){
 requestSeq++;
 if(activeMap){
  try{activeMap.remove()}catch{}
  activeMap=null;
 }
}

function popupNode(points){
 const box=document.createElement('div');
 box.className='pluv-map-popup';
 const heading=document.createElement('strong');
 heading.textContent=points.length===1?points[0].name:points.length+' medições neste local';
 box.appendChild(heading);
 for(const point of points.slice(0,25)){
  const line=document.createElement('div');
  line.className='pluv-map-popup-line';
  line.textContent=point.name+' · '+point.mm+' mm · '+point.when;
  box.appendChild(line);
 }
 if(points.length>25){
  const overflow=document.createElement('small');
  overflow.textContent='Mais '+(points.length-25)+' medições nesta posição.';
  box.appendChild(overflow);
 }
 const link=document.createElement('a');
 const {latitude,longitude}=points[0];
 link.href=googleSatelliteUrl(latitude,longitude);
 link.target='_blank';link.rel='noopener noreferrer';
 link.textContent='Ver no Google Satélite ↗';
 box.appendChild(link);
 return box;
}

export async function mountReadingsMap(points){
 disposeReadingsMap();
 const seq=requestSeq;
 const status=document.getElementById('mapLoadStatus');
 const element=document.getElementById('pluvMap');
 if(!element||!points.length)return;
 if(status)status.textContent='Carregando mapa…';
 try{
  const lib=await ensureMapLibre();
  if(seq!==requestSeq||document.getElementById('pluvMap')!==element)return;
  const first=points[0];
  const map=new lib.Map({
   container:element,
   style:FREE_STYLE,
   center:[first.longitude,first.latitude],
   zoom:points.length===1?16:11,
   pitch:0,bearing:0,
   attributionControl:true
  });
  activeMap=map;
  map.addControl(new lib.NavigationControl({showCompass:false}), 'top-right');
  map.scrollZoom.disable(); // A roda nao deve deslocar o mapa sem querer.
  const groups=new Map();
  for(const point of points){
   const key=point.latitude.toFixed(5)+','+point.longitude.toFixed(5);
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(point);
  }
  const bounds=new lib.LngLatBounds();
  for(const group of groups.values()){
   const firstPoint=group[0];
   const markerElement=document.createElement('div');
   markerElement.className='pluv-map-marker';
   markerElement.title=firstPoint.name+' · '+group.length+' medição(ões)';
   markerElement.setAttribute('aria-label',firstPoint.name);
   const marker=new lib.Marker({element:markerElement,anchor:'center'})
    .setLngLat([firstPoint.longitude,firstPoint.latitude])
    .setPopup(new lib.Popup({offset:16,maxWidth:'350px'}).setDOMContent(popupNode(group)))
    .addTo(map);
   bounds.extend(marker.getLngLat());
  }
  if(groups.size>1)map.fitBounds(bounds,{padding:48,maxZoom:16,duration:0});
  const loaded=()=>{if(seq===requestSeq&&status)status.textContent=groups.size+' ponto(s) de registro no mapa · OpenFreeMap'};
  map.on('load',loaded);
  map.on('error',event=>{
   if(seq!==requestSeq)return;
   // Falhas de conexao do estilo ou tiles sao exibidas sem perder coordenadas.
   const problem=String(event.error?.message||'').toLowerCase();
   if(problem.includes('403')||problem.includes('401')||problem.includes('failed to fetch')||problem.includes('not found')){
    if(status)status.textContent='O provedor do mapa não respondeu. As coordenadas permanecem listadas abaixo.';
   }
  });
  setTimeout(()=>{
   if(seq===requestSeq&&status&&status.textContent==='Carregando mapa…')
    status.textContent='Aguardando o mapa carregar. Caso não apareça, use os links de coordenadas abaixo.';
  },14000);
 }catch(error){
  if(seq!==requestSeq)return;
  if(status)status.textContent='O mapa não carregou. Verifique a internet ou use os links de coordenadas abaixo.';
  if(element)element.classList.add('pluv-map-error');
  console.warn('PLUV mapa:',error);
 }
}

// Gerenciador desktop do mapa. Apenas medições com latitude e longitude reais.
const safe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function numberPt(value){return Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2})}
export function collectMapPoints(gauges,readings,filterId=''){
 const names=new Map(gauges.map(g=>[g.id,g.name]));
 return readings.filter(r=>{
  const latitude=Number(r.latitude), longitude=Number(r.longitude);
  return names.has(r.gaugeId)&&(!filterId||r.gaugeId===filterId)&&
   r.latitude!=null&&r.longitude!=null&&Number.isFinite(latitude)&&Number.isFinite(longitude)&&
   latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180;
 }).sort((a,b)=>b.at.localeCompare(a.at)).map(r=>({
  id:r.id,gaugeId:r.gaugeId,name:names.get(r.gaugeId),
  latitude:Number(r.latitude),longitude:Number(r.longitude),
  accuracyM:r.accuracyM,mm:numberPt(r.mm),
  when:new Date(r.at).toLocaleString('pt-BR'),at:r.at
 }));
}
export function mapScreenHtml(gauges,readings,filterId=''){
 const points=collectMapPoints(gauges,readings,filterId);
 const gaugeCount=new Set(points.map(p=>p.gaugeId)).size;
 const total=readings.filter(r=>!filterId||r.gaugeId===filterId).length;
 const options=[...gauges].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
  .map(g=>`<option value="${safe(g.id)}" ${filterId===g.id?'selected':''}>${safe(g.name)}</option>`).join('');
 const rows=points.slice(0,200).map(p=>`<tr>
  <td><strong>${safe(p.name)}</strong></td><td>${safe(p.when)}</td>
  <td class="numeric">${safe(p.mm)} mm</td>
  <td class="gps-coords">${safe(p.latitude.toFixed(6)+', '+p.longitude.toFixed(6))}</td>
  <td><a href="${safe(googleSatelliteUrl(p.latitude,p.longitude))}"
    target="_blank" rel="noopener noreferrer">Satélite ↗</a></td>
 </tr>`).join('');
 return `<section class="map-screen">
  <header class="map-head">
   <div><span class="admin-eyebrow">GERENCIAMENTO · LOCALIZAÇÃO</span>
    <h2>Mapa das medições</h2>
    <p>Confira no mapa onde o celular estava quando registrou cada chuva.</p>
    ${points.length?`<a class="map-satellite-link" target="_blank" rel="noopener noreferrer"
      href="${safe(googleSatelliteUrl(points[0].latitude,points[0].longitude))}">
      ◉ Ver no Google Satélite ↗</a>`:''}
   </div>
   <div class="map-filter"><label for="mapGauge">Pluviômetro</label>
    <select id="mapGauge"><option value="">Todos</option>${options}</select></div>
  </header>
  <div class="map-metrics">
   <span><strong>${points.length}</strong> medição(ões) com GPS</span>
   <span><strong>${gaugeCount}</strong> pluviômetro(s) localizado(s)</span>
   <span><strong>${total-points.length}</strong> medição(ões) sem GPS</span>
  </div>
  ${points.length?`<div id="pluvMap" class="pluv-map" role="region"
    aria-label="Mapa dos pontos de medição"></div>
    <p id="mapLoadStatus" class="map-status" role="status">Preparando mapa…</p>`:
   '<div class="empty map-empty">Nenhuma medição com GPS para esta seleção. Ao registrar uma nova chuva no celular, autorize o acesso à localização. Não é possível recuperar o GPS de registros antigos que foram salvos sem coordenadas.</div>'}
  <section class="report-block map-detail"><h3>Locais dos registros</h3>
   <div class="report-table-wrap"><table class="report-table">
    <thead><tr><th>Pluviômetro</th><th>Data e hora</th><th class="numeric">Chuva</th><th>Coordenadas</th><th>Mapa externo</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="5">Sem registros geolocalizados.</td></tr>'}</tbody>
   </table></div>
   ${points.length>200?`<p class="map-status">A tabela mostra os 200 registros mais recentes. O mapa inclui os ${points.length} registros.</p>`:''}
  </section>
  <p class="map-notice">O mapa do PLUV usa OpenFreeMap para mostrar todos os marcadores. "Google Satélite" abre em uma nova aba, centrado na coordenada selecionada; não mostra todos os marcadores juntos. Para incorporar o mapa do Google diretamente, é necessária a API oficial. A posição é do celular no momento da medição.</p>
 </section>`;
}
