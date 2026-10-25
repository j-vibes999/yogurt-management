import Link from "next/link";
import { AnimatedNumber } from "@/components/animated-number";
import { MiniSparkline } from "@/components/mini-sparkline";
import { AppIcon, type AppIconName } from "@/components/app-icon";

export function DashboardMetric({href,label,value,detail,tone="mint",icon="sparkles",money=false,chart}:{href:string;label:string;value:number;detail:string;tone?:"mint"|"blue"|"olive"|"cream";icon?:AppIconName;money?:boolean;chart?:number[]}){
  return <Link href={href} className={`bento-metric-v26 tone-${tone}`}>
    <div className="bento-metric-top-v26"><span className="bento-icon-v26"><AppIcon name={icon} size={18}/></span><span>{label}</span></div>
    <strong className={money?"is-money":""}><AnimatedNumber value={value} format={money?"money":"number"}/></strong>
    <small>{detail}</small>
    {chart&&chart.length>1&&<MiniSparkline values={chart}/>}<span className="bento-arrow-v26"><AppIcon name="arrowRight" size={15}/></span>
  </Link>;
}
