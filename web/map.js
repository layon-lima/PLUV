// Mapa somente no desktop. OpenStreetMap/Leaflet sao carregados sob demanda.
// O registro offline de chuva nao depende dos servidores do mapa.
const CDN = 'https://unpkg.com/leaflet@1.9.4/dist/';
const JS_HASH = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
const CSS_HASH = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyo1ZRw/7u6oH6U=';
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
