"use client";
import { useEffect, useState } from "react";

export function usePersistedFilter(key:string, fallback:string, allowed:readonly string[]){
  const [value,setValue]=useState(fallback);
  const allowedKey=allowed.join("\u0000");
  useEffect(()=>{try{const saved=localStorage.getItem(key);const allowedValues=allowedKey.split("\u0000");if(saved&&allowedValues.includes(saved))setValue(saved)}catch{}},[key,allowedKey]);
  const setSafe=(next:string)=>{
    const safe=allowed.includes(next)?next:fallback;
    try{localStorage.setItem(key,safe)}catch{}
    setValue(safe);
  };
  return [value,setSafe] as const;
}
