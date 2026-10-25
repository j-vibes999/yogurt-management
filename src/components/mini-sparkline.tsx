export function MiniSparkline({ values }: { values:number[] }) {
  const safe=values.length?values:[0,0,0,0]; const max=Math.max(...safe,1), min=Math.min(...safe,0); const span=Math.max(max-min,1);
  const points=safe.map((v,i)=>`${safe.length===1?50:(i/(safe.length-1))*100},${34-((v-min)/span)*28}`).join(" ");
  return <svg className="mini-sparkline-v26" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true"><path className="mini-sparkline-area-v26" d={`M ${points.replace(/ /g,' L ')} L 100 38 L 0 38 Z`}/><polyline points={points} fill="none"/></svg>;
}
