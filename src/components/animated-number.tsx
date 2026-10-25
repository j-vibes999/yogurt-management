"use client";
import { useEffect, useRef, useState } from "react";

export function AnimatedNumber({ value, format="number", suffix="" }: { value:number; format?:"number"|"money"; suffix?:string }) {
  const [display,setDisplay]=useState(value);
  const previous=useRef(value);
  useEffect(()=>{
    const from=previous.current; const to=value; previous.current=value;
    if (from===to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDisplay(to); return; }
    const start=performance.now(); const duration=420;
    let raf=0;
    const tick=(now:number)=>{ const p=Math.min(1,(now-start)/duration); const eased=1-Math.pow(1-p,3); setDisplay(from+(to-from)*eased); if(p<1) raf=requestAnimationFrame(tick); };
    raf=requestAnimationFrame(tick); return()=>cancelAnimationFrame(raf);
  },[value]);
  const text=format==="money" ? `${Math.round(display).toLocaleString("en-US")} LAK` : `${Math.round(display).toLocaleString("en-US")}${suffix}`;
  return <>{text}</>;
}
