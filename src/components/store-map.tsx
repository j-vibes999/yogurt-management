"use client";
import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { canRoleOpen } from "@/lib/access-policy";
import type { UserRole } from "@/lib/auth-session";

type RefillStatus="waiting"|"preparing"|"delivering"|null;
type StorePoint={id:string;name:string;address:string;latitude:number;longitude:number;stock:number;capacity:number;due:boolean;lowStock:boolean;fridgeStatus:"active"|"maintenance";assetCode:string;refillStatus:RefillStatus;outstanding:number;contactName:string;phone:string;whatsapp:string;fridgeNumber:string;yogurt:{name:string;quantity:number}[]};
type FilterKey="all"|"due"|"refill"|"low"|"maintenance"|"outstanding";
const DEFAULT_CENTER:[number,number]=[102.6137,17.9757];
const STREET_STYLE={version:8 as const,sources:{osm:{type:"raster" as const,tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap contributors"}},layers:[{id:"osm",type:"raster" as const,source:"osm",minzoom:0,maxzoom:19}]};
const SATELLITE_STYLE={version:8 as const,sources:{satellite:{type:"raster" as const,tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],tileSize:256,attribution:"Tiles © Esri"}},layers:[{id:"satellite",type:"raster" as const,source:"satellite",minzoom:0,maxzoom:19}]};
function statusOf(s:StorePoint){if(s.fridgeStatus==="maintenance")return{key:"maintenance",label:"ບຳລຸງຮັກສາ"};if(s.refillStatus)return{key:"refill",label:s.refillStatus==="delivering"?"ກຳລັງສົ່ງ":s.refillStatus==="preparing"?"ກຳລັງຈັດສິນຄ້າ":"ລໍຖ້າຈັດສິນຄ້າ"};if(s.due)return{key:"due",label:"ຮອດຮອບກວດ"};if(s.lowStock)return{key:"low",label:"ຈຳນວນຄົງເຫຼືອຕ່ຳ"};return{key:"ok",label:"ປົກກະຕິ"}}
const moneyFormat=new Intl.NumberFormat("en-US",{maximumFractionDigits:2});
const money=(n:number)=>`${moneyFormat.format(n)} LAK`;
export function StoreMap({stores,role}:{stores:StorePoint[];role:UserRole|null}){
 const mapNode=useRef<HTMLDivElement|null>(null),mapRef=useRef<MapLibreMap|null>(null),markers=useRef<Map<string,Marker>>(new Map()),viewBeforeSelect=useRef<{center:[number,number];zoom:number}|null>(null);
 const [selected,setSelected]=useState<string|null>(null),[mapMode,setMapMode]=useState<"street"|"satellite">("street"),[query,setQuery]=useState(""),[filter,setFilter]=useState<FilterKey>("all"),[moreFilters,setMoreFilters]=useState(false),[loaded,setLoaded]=useState(false);
 const [mapError,setMapError]=useState<string|null>(null),[mapAttempt,setMapAttempt]=useState(0);
 const mapStyleRef=useRef(mapMode);mapStyleRef.current=mapMode;
 const detailRef=useRef<HTMLDivElement>(null);
 const previousMapMode=useRef(mapMode);
 useEffect(()=>{if(selected)detailRef.current?.focus()},[selected]);
 const counts=useMemo(()=>({all:stores.length,due:stores.filter(s=>s.due).length,refill:stores.filter(s=>!!s.refillStatus).length,low:stores.filter(s=>s.lowStock).length,maintenance:stores.filter(s=>s.fridgeStatus==="maintenance").length,outstanding:stores.filter(s=>s.outstanding>0).length}),[stores]);
 const visible=useMemo(()=>{const q=query.trim().toLocaleLowerCase();return stores.filter(s=>(!q||`${s.name} ${s.address} ${s.assetCode}`.toLocaleLowerCase().includes(q))&&(filter==="all"||(filter==="due"&&s.due)||(filter==="refill"&&!!s.refillStatus)||(filter==="low"&&s.lowStock)||(filter==="maintenance"&&s.fridgeStatus==="maintenance")||(filter==="outstanding"&&s.outstanding>0)))},[stores,query,filter]);
 const fit=useCallback((list:StorePoint[])=>{const map=mapRef.current;if(!map)return;if(!list.length){map.easeTo({center:DEFAULT_CENTER,zoom:12,duration:350});return}if(list.length===1){map.easeTo({center:[list[0].longitude,list[0].latitude],zoom:16,duration:400});return}const b=new maplibregl.LngLatBounds();list.forEach(s=>b.extend([s.longitude,s.latitude]));map.fitBounds(b,{padding:{top:80,bottom:80,left:70,right:70},maxZoom:15,duration:400})},[]);
 const focus=useCallback((s:StorePoint)=>{setSelected(s.id);const map=mapRef.current;if(!map)return;if(!viewBeforeSelect.current)viewBeforeSelect.current={center:[map.getCenter().lng,map.getCenter().lat],zoom:map.getZoom()};map.stop();map.setCenter([Number(s.longitude),Number(s.latitude)]);},[]);
 function closeDetail(){const map=mapRef.current,previous=viewBeforeSelect.current;setSelected(null);if(map&&previous){map.stop();map.jumpTo({center:previous.center,zoom:previous.zoom});}viewBeforeSelect.current=null;if(selected)document.getElementById(`map-store-${selected}`)?.focus();}
 useEffect(()=>{
   if(!mapNode.current||mapRef.current)return;
   const markerStore=markers.current;
   let map:MapLibreMap|null=null,active=true;
   const unavailable=()=>{if(active){setLoaded(false);setMapError("ແຜນທີ່ໂຫຼດບໍ່ສຳເລັດ. ຍັງເລືອກຮ້ານຈາກລາຍການ ເພື່ອເບິ່ງລາຍລະອຽດ ແລະເປີດ Google Maps ໄດ້.")}};
   const timeout=window.setTimeout(unavailable,15000);
   try{
     map=new maplibregl.Map({container:mapNode.current,style:mapStyleRef.current==="satellite"?SATELLITE_STYLE:STREET_STYLE,center:DEFAULT_CENTER,zoom:12,minZoom:3,maxZoom:19,attributionControl:false,dragRotate:false,pitchWithRotate:false,touchPitch:false,cooperativeGestures:false});
     mapRef.current=map;
     map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
     map.addControl(new maplibregl.AttributionControl({compact:true}),"bottom-right");
     const ready=()=>{if(active){window.clearTimeout(timeout);setLoaded(true);setMapError(null);requestAnimationFrame(()=>{if(active)map?.resize()})}};
     map.on("load",ready);map.on("style.load",ready);map.on("error",unavailable);
   }catch{window.clearTimeout(timeout);unavailable();}
   return()=>{active=false;window.clearTimeout(timeout);markerStore.forEach(marker=>marker.remove());markerStore.clear();map?.remove();mapRef.current=null};
 },[mapAttempt]);
 useEffect(()=>{
   if(previousMapMode.current===mapMode)return;
   previousMapMode.current=mapMode;
   const map=mapRef.current;if(!map)return;
   setLoaded(false);setMapError(null);
   const timeout=window.setTimeout(()=>setMapError("ໂຫຼດແຜນທີ່ບໍ່ທັນສຳເລັດ. ກະລຸນາລອງໃໝ່ ຫຼືໃຊ້ລາຍການຮ້ານ."),15000);
   const ready=()=>window.clearTimeout(timeout);map.once("style.load",ready);
   try{map.setStyle(mapMode==="satellite"?SATELLITE_STYLE:STREET_STYLE)}catch{setMapError("ປ່ຽນຮູບແບບແຜນທີ່ບໍ່ສຳເລັດ. ກະລຸນາລອງໂຫຼດແຜນທີ່ໃໝ່.")}
   return()=>{window.clearTimeout(timeout);map.off("style.load",ready)};
 },[mapMode]);
 useEffect(()=>{
   const map=mapRef.current;if(!map||!loaded)return;
   const markerStore=markers.current,visibleIds=new Set(visible.map(store=>store.id));
   markerStore.forEach((marker,id)=>{if(!visibleIds.has(id)){marker.remove();markerStore.delete(id)}});
   visible.forEach(store=>{
     const status=statusOf(store),existing=markerStore.get(store.id);
     const element=existing?.getElement()??document.createElement("button");
     if(!existing){
       (element as HTMLButtonElement).type="button";
       const pin=document.createElement("span"),number=document.createElement("b"),label=document.createElement("span"),name=document.createElement("b"),fridge=document.createElement("small");
       pin.className="ml-marker-pin";label.className="ml-marker-label";
       pin.append(number);label.append(name,fridge);element.append(pin,label);
     }
     element.className=`ml-store-marker ${status.key}`;
     element.title=store.name;
     element.setAttribute("aria-label",`${store.name}, ${status.label}`);
     element.querySelector(".ml-marker-pin b")!.textContent=store.fridgeNumber.replace(/^FR-0*/,"")||store.fridgeNumber;
     element.querySelector(".ml-marker-label b")!.textContent=store.name;
     element.querySelector(".ml-marker-label small")!.textContent=`ຕູ້ ${store.fridgeNumber}`;
     element.onclick=event=>{event.stopPropagation();focus(store)};
     if(existing)existing.setLngLat([Number(store.longitude),Number(store.latitude)]);
     else markerStore.set(store.id,new maplibregl.Marker({element,anchor:"bottom",offset:[0,0]}).setLngLat([Number(store.longitude),Number(store.latitude)]).addTo(map));
   });
 },[visible,loaded,focus]);
 useEffect(()=>{markers.current.forEach((marker,id)=>marker.getElement().classList.toggle("is-selected",selected===id))},[selected,visible,loaded]);
 useEffect(()=>{if(!loaded)return;const frame=requestAnimationFrame(()=>fit(visible));return()=>cancelAnimationFrame(frame)},[visible,loaded,fit]);
 const chosen=stores.find(s=>s.id===selected)||null;const filters:Array<{key:FilterKey;label:string}>=[{key:"all",label:"ທັງໝົດ"},{key:"due",label:"ຮອດຮອບ"},{key:"refill",label:"ເຕີມສິນຄ້າ"},{key:"low",label:"ຈຳນວນຄົງເຫຼືອຕ່ຳ"},{key:"maintenance",label:"ບຳລຸງ"},{key:"outstanding",label:"ຄ້າງຮັບ"}];
 return <section className="map-explorer-v4"><aside className="map-sidebar-v4 color-panel"><div className="map-sidebar-head-v4 color-panel-heading"><div><span className="panel-kicker">ຮ້ານທັງໝົດ</span><h2>{stores.length} ຮ້ານ</h2></div><span className="map-live-chip" data-state={mapError?"error":loaded?"ready":"loading"} role="status"><i aria-hidden="true"/> {mapError?"ໃຊ້ລາຍການຮ້ານ":loaded?"ແຜນທີ່ພ້ອມໃຊ້":"ກຳລັງໂຫຼດ…"}</span></div>{mapError&&<div className="map-recovery-notice" role="status"><p>{mapError}</p><button type="button" className="button button-secondary" onClick={()=>{setLoaded(false);setMapError(null);setMapAttempt(value=>value+1)}}>ລອງໂຫຼດແຜນທີ່ໃໝ່</button></div>}<label className="map-store-search-v4"><span><Search size={16} aria-hidden="true" /></span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ຄົ້ນຫາຮ້ານ, ທີ່ຢູ່, ລະຫັດຕູ້…" aria-label="ຄົ້ນຫາຮ້ານໃນແຜນທີ່" enterKeyHint="search"/>{query&&<button type="button" aria-label="ລ້າງການຄົ້ນຫາ" onClick={()=>setQuery("")}><X size={16} aria-hidden="true" /></button>}</label><div className="map-filter-row-v4">{filters.map((x,index)=><button type="button" key={x.key} className={`${filter===x.key?"is-active":""} ${index>3?"map-filter-secondary-v33":""}`.trim()} aria-pressed={filter===x.key} data-visible={index<=3||moreFilters?"true":"false"} onClick={()=>setFilter(x.key)}>{x.label}<span>{counts[x.key]}</span></button>)}<button type="button" className="map-filter-more-v33" onClick={()=>setMoreFilters(v=>!v)} aria-expanded={moreFilters}>{moreFilters?"ໜ້ອຍລົງ":"ເພີ່ມເຕີມ"}</button></div><div className="map-result-summary-v4"><strong>{visible.length}</strong> ຮ້ານ<button type="button" disabled={!loaded} onClick={()=>fit(visible)}>ສະແດງທັງໝົດ</button></div><div className="map-store-list-v4">{visible.map(s=>{const st=statusOf(s),pct=Math.max(0,Math.min(100,Math.round(s.stock/Math.max(s.capacity,1)*100)));return <button type="button" id={`map-store-${s.id}`} key={s.id} className={`map-store-card-v4 ${selected===s.id?"is-selected":""}`} onClick={()=>focus(s)}><div className="map-store-card-top-v4"><span className={`map-status-dot-v4 ${st.key}`}/><div className="map-store-name-v4"><strong>{s.name}</strong><span>{s.assetCode} · {s.address}</span></div><span className={`map-status-badge-v4 ${st.key}`}>{st.label}</span></div><div className="map-stock-line-v4"><div><span>ຄົງເຫຼືອ</span><strong>{s.stock}/{s.capacity}</strong></div><div className="map-stock-meter-v4"><i className={s.lowStock?"low":""} style={{width:`${pct}%`}}/></div></div><div className="map-store-meta-v4"><span>{pct}% ຂອງຄວາມຈຸ</span><span className={s.outstanding>0?"has-balance":""}>{s.outstanding>0?`ຄ້າງ ${money(s.outstanding)}`:"ບໍ່ມີຍອດຄ້າງ"}</span></div></button>})}{!visible.length&&<div className="map-empty-v4"><strong>ບໍ່ພົບຮ້ານ</strong><span>ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼື ຕົວກອງ.</span><button type="button" onClick={()=>{setQuery("");setFilter("all")}}>ລ້າງ ຕົວກອງ</button></div>}</div></aside><div className={`map-stage-v4 ${mapError?"map-is-unavailable":""}`}><div ref={mapNode} className="maplibre-canvas-v5"/>{!loaded&&!mapError&&<div className="map-loading-v5" role="status">ກຳລັງໂຫຼດແຜນທີ່…</div>}{mapError&&<div className="map-fallback-message"><strong>ແຜນທີ່ບໍ່ພ້ອມໃຊ້</strong><span>ເລືອກຮ້ານຈາກລາຍການເພື່ອເບິ່ງລາຍລະອຽດ.</span></div>}<div className="map-mode-v6"><button type="button" disabled={!loaded} className={mapMode==="street"?"is-active":undefined} onClick={()=>setMapMode("street")}>ແຜນທີ່</button><button type="button" disabled={!loaded} className={mapMode==="satellite"?"is-active":undefined} onClick={()=>setMapMode("satellite")}>ດາວທຽມ</button></div><button type="button" className="map-fit-v5" disabled={!loaded} onClick={()=>fit(visible)}>ເບິ່ງທຸກຮ້ານ</button>{chosen&&<div className="map-detail-v5" role="region" aria-label={`ລາຍລະອຽດ ${chosen.name}`} tabIndex={-1} ref={detailRef}><button type="button" className="map-detail-close-v5" aria-label="ປິດລາຍລະອຽດ" onClick={closeDetail}><X size={17} aria-hidden="true" /></button><div className="map-popup-head-v4"><span className={`map-status-dot-v4 ${statusOf(chosen).key}`}/><div><strong>{chosen.name}</strong><span>{chosen.assetCode}</span></div></div><p>{chosen.address}</p><div className="map-contact-v5"><div><span>ຊື່ເຈົ້າຂອງ</span><strong>{chosen.contactName}</strong></div><div><span>ໂທ</span><strong>{chosen.phone}</strong></div><div><span>WhatsApp</span><strong>{chosen.whatsapp}</strong></div><div><span>ຕູ້</span><strong>{chosen.fridgeNumber}</strong></div></div><div className="map-yogurt-v5"><span className="map-section-label-v5 color-section-heading">ໂຢເກີດໃນຕູ້</span>{chosen.yogurt.map((item)=><div key={item.name}><span>{item.name}</span><strong>{item.quantity} ຖ້ວຍ</strong></div>)}</div><div className="map-popup-stats-v4"><div className={chosen.lowStock?"color-metric-warning":"color-metric-domain"}><span>ຄົງເຫຼືອ</span><strong>{chosen.stock}/{chosen.capacity}</strong></div><div className={chosen.outstanding>0?"color-metric-warning":"color-metric-success"}><span>ຍອດຄ້າງ</span><strong>{money(chosen.outstanding)}</strong></div></div><div className="map-popup-actions-v4">{canRoleOpen(role,`/driver/restock/${chosen.id}`)&&<Link href={`/driver/restock/${chosen.id}`}>ເລີ່ມກວດ</Link>}<a href={`https://www.google.com/maps/dir/?api=1&destination=${chosen.latitude},${chosen.longitude}`} target="_blank" rel="noreferrer">Google Maps <ExternalLink size={14} aria-hidden="true" /></a></div></div>}<div className="map-legend-v4"><span><i className="ok"/>ປົກກະຕິ</span><span><i className="due"/>ຮອດຮອບ</span><span><i className="refill"/>ເຕີມສິນຄ້າ</span><span><i className="maintenance"/>ບຳລຸງ</span></div></div></section>
}
