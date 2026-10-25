"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import "./login.css";

function MailIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16v11H4z"/><path d="m4.8 7.3 7.2 5.8 7.2-5.8"/></svg>}
function LockIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2"/></svg>}
function EyeIcon({off=false}:{off?:boolean}){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/>{off&&<path d="M4 4l16 16"/>}</svg>}
function ArrowIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>}
function MotionIcon({paused}:{paused:boolean}){return <svg viewBox="0 0 20 20" aria-hidden="true">{paused?<path d="m7 4 9 6-9 6V4Z"/>:<><path d="M7 4v12M13 4v12"/></>}</svg>}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword,setShowPassword]=useState(false);
  const [motionPaused,setMotionPaused]=useState(false);
  const errorRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "ອີເມວ ຫຼືລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("ບໍ່ສາມາດເຂົ້າລະບົບໄດ້ ກະລຸນາລອງໃໝ່");
    } finally {
      setBusy(false);
    }
  }

  return <main className="sign-in-screen">
    <a className="sign-in-skip" href="#sign-in-form">ໄປຫາແບບຟອມເຂົ້າລະບົບ</a>
    <aside className="sign-in-story" aria-label="Yogurt Manager">
      <div className="sign-in-brand" translate="no"><span className="sign-in-brand-mark"><BrandMark /></span><strong>Yogurt Manager</strong></div>
      <div className="sign-in-story-body">
        <span className="sign-in-eyebrow">ທຸລະກິດໂຢເກີດຂອງທ່ານ</span>
        <p className="sign-in-story-title">ທຸກວຽກເຊື່ອມກັນ.<br/>ຈັດການງ່າຍໃນບ່ອນດຽວ.</p>
        <p className="sign-in-story-description">ຈາກການຜະລິດ ແລະເຕີມສິນຄ້າ<br className="sign-in-desktop-break"/> ສູ່ການຈັດການຮ້ານ ແລະລາຍຮັບ.</p>
        <div className="sign-in-artwork" data-motion={motionPaused?"paused":"running"}>
          <div className="sign-in-scene" aria-hidden="true"><Image src="/illustrations/login-yogurt.svg" width={600} height={400} alt="" priority unoptimized draggable={false}/></div>
          <button className="sign-in-motion" type="button" onClick={()=>setMotionPaused(value=>!value)}>
            <MotionIcon paused={motionPaused}/><span>{motionPaused?"ເປີດພາບເຄື່ອນໄຫວ":"ຢຸດພາບເຄື່ອນໄຫວ"}</span>
          </button>
        </div>
        <div className="sign-in-domains" aria-label="ວຽກໃນລະບົບ"><span>ຜະລິດ</span><span>ຈັດການຮ້ານ</span><span>ການເງິນ</span></div>
      </div>
      <p className="sign-in-story-footer" translate="no">Yogurt Manager · EST. 2026</p>
    </aside>

    <section className="sign-in-region" aria-labelledby="sign-in-title">
      <div className="sign-in-panel" id="sign-in-form" tabIndex={-1}>
        <div className="sign-in-panel-heading">
          <span className="sign-in-eyebrow">ເຂົ້າສູ່ Yogurt Manager</span>
          <h1 id="sign-in-title">ຍິນດີຕ້ອນຮັບ</h1>
          <p>ເຂົ້າລະບົບເພື່ອຈັດການທຸລະກິດຂອງທ່ານ</p>
        </div>
        <form className="sign-in-form" onSubmit={submit} aria-busy={busy}>
          <div className="sign-in-field">
            <label htmlFor="sign-in-email">ອີເມວ</label>
            <div className="sign-in-input-row">
              <span className="sign-in-icon"><MailIcon/></span>
              <input id="sign-in-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required defaultValue="heyman@yogurt.com" />
            </div>
          </div>
          <div className="sign-in-field">
            <label htmlFor="sign-in-password">ລະຫັດຜ່ານ</label>
            <div className="sign-in-input-row">
              <span className="sign-in-icon"><LockIcon/></span>
              <input id="sign-in-password" name="password" type={showPassword?"text":"password"} autoComplete="current-password" required />
              <button className="sign-in-eye" type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?"ເຊື່ອງລະຫັດຜ່ານ":"ສະແດງລະຫັດຜ່ານ"} aria-controls="sign-in-password"><EyeIcon off={showPassword}/></button>
            </div>
          </div>
          {error && <div className="sign-in-error" id="sign-in-error" role="alert" tabIndex={-1} ref={errorRef}><strong>ເຂົ້າລະບົບບໍ່ສຳເລັດ</strong><span>{error}</span></div>}
          <button className="sign-in-submit" type="submit" disabled={busy}>
            <span>{busy?"ກຳລັງເຂົ້າລະບົບ…":"ເຂົ້າລະບົບ"}</span>
            {busy?<svg className="sign-in-loading" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>:<ArrowIcon/>}
          </button>
        </form>
        <div className="sign-in-help">
          <span className="sign-in-help-icon" aria-hidden="true">?</span>
          <div><strong>ເຂົ້າລະບົບບໍ່ໄດ້?</strong><p>ຕິດຕໍ່ຜູ້ດູແລລະບົບເພື່ອກວດສອບບັນຊີ</p></div>
        </div>
        <p className="sign-in-staff">ສຳລັບພະນັກງານ <span translate="no">Yogurt Manager</span></p>
      </div>
    </section>
  </main>;
}
