"use client";

import Link from "next/link";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[yogurt-ui] route error", error); }, [error]);
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,background:"var(--background,#f7f8f6)"}}><div className="card panel-card" style={{maxWidth:560,width:"100%"}}><div className="eyebrow">ຂໍ້ຜິດພາດ</div><h1 style={{marginTop:8}}>ບໍ່ສາມາດໂຫຼດໜ້ານີ້ໄດ້</h1><p style={{color:"var(--muted)"}}>ກວດຖານຂໍ້ມູນ ແລະເຄືອຂ່າຍແລ້ວລອງໃໝ່. ລາຍການທີ່ດຳເນີນການບໍ່ສຳເລັດຈະບໍ່ຖືກບັນທຶກຄ້າງ.</p>{error.digest && <div className="store-meta">Reference: {error.digest}</div>}<div style={{display:"flex",gap:10,marginTop:18}}><button className="button button-primary" onClick={reset}>ລອງໃໝ່</button><Link className="button button-secondary" href="/">ກັບໜ້າຫຼັກ</Link></div></div></main>;
}
