// Mapa somente no desktop. OpenStreetMap/Leaflet sao carregados sob demanda.
// O registro offline de chuva nao depende dos servidores do mapa.
const CDN = 'https://unpkg.com/leaflet@1.9.4/dist/';
const JS_HASH = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
const CSS_HASH = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
let loader;
let activeMap = null;
let requestSeq = 0;

function ensureLeaflet(){
 if(window.L?.map)return Promise.resolve(window.L);
 if(loader)return loader;
 loader=new Promise((resolve,reject)=>{
  if(!document.getElementById('leafletStyles')){
   const css=document.createElement('link');
   css.id='leafletStyles';css.rel='stylesheet';css.href=CDN+'leaflet.css';
   css.integrity=CSS_HASH;css.crossOrigin='anonymous';
   document.head.appendChild(css);
  }
  const script=document.createElement('script');
  script.src=CDN+'leaflet.js';script.integrity=JS_HASH;script.crossOrigin='anonymous';
  script.async=true;
  const timer=setTimeout(()=>reject(Error('Tempo esgotado ao carregar o mapa')),15000);
  script.onload=()=>{clearTimeout(timer);window.L?.map?resolve(window.L):reject(Error('Mapa indisponivel'))};
  script.onerror=()=>{clearTimeout(timer);reject(Error('Nao foi possivel carregar o mapa'))};
  document.head.appendChild(script);
 }).catch(e=>{loader=null;throw e});
 return loader;
}

export function disposeReadingsMap(){
 requestSeq++;
 if(activeMap){try{activeMap.remove()}catch{};activeMap=null}
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
 link.href='https://www.google.com/maps?q='+latitude+','+longitude;
 link.target='_blank';link.rel='noopener noreferrer';
 link.textContent='Abrir coordenadas no Google Maps ↗';
 box.appendChild(link);
 return box;
}

export async function mountReadingsMap(points){
 disposeReadingsMap();
 const seq=requestSeq;
 const status=document.getElementById('mapLoadStatus');
 const element=document.getElementById('pluvMap');
 if(!element||!points.length)return;
 if(status)status.textContent='Carregando o mapa…';
 try{
  const L=await ensureLeaflet();
  if(seq!==requestSeq||document.getElementById('pluvMap')!==element)return;
  const map=L.map(element,{scrollWheelZoom:false});
  activeMap=map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
   attribution:'&copy; OpenStreetMap contributors',
   maxZoom:19
  }).addTo(map);
  const groups=new Map();
  for(const point of points){
   const key=point.latitude.toFixed(5)+','+point.longitude.toFixed(5);
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(point);
  }
  const markers=[];
  for(const group of groups.values()){
   const first=group[0];
   const marker=L.circleMarker([first.latitude,first.longitude],{
    radius:group.length===1?9:12,
    weight:2,color:'#fff',fillColor:'#09859c',fillOpacity:0.95
   }).addTo(map);
   marker.bindPopup(popupNode(group),{maxWidth:350});
   markers.push(marker);
  }
  if(markers.length===1)map.setView(markers[0].getLatLng(),16);
  else map.fitBounds(L.featureGroup(markers).getBounds(),{padding:[38,38],maxZoom:16});
  map.invalidateSize();
  if(status)status.textContent=groups.size+' ponto(s) de registro no mapa';
 }catch(e){
  if(seq!==requestSeq)return;
  if(status)status.textContent='O mapa não carregou. Verifique a internet; as coordenadas continuam listadas abaixo.';
  if(element)element.classList.add('pluv-map-error');
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
  <td><a href="${safe('https://www.google.com/maps?q='+p.latitude+','+p.longitude)}"
    target="_blank" rel="noopener noreferrer">Abrir ↗</a></td>
 </tr>`).join('');
 return `<section class="map-screen">
  <header class="map-head">
   <div><span class="admin-eyebrow">GERENCIAMENTO · LOCALIZAÇÃO</span>
    <h2>Mapa das medições</h2>
    <p>Confira no mapa onde o celular estava quando registrou cada chuva.</p></div>
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
  <p class="map-notice">Mapa © OpenStreetMap. Os pontos representam a posição do celular na hora da medição, não necessariamente a localização fixa do pluviômetro. O mapa requer internet, mas registrar chuva não.</p>
 </section>`;
}
