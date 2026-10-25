import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Noto_Sans_Lao } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import "../src/app/globals.css";
import "../src/app/professional.css";
import "../src/app/workspace-colors.css";

const notoSansLao = Noto_Sans_Lao({
  subsets: ["lao", "latin"],
  variable: "--font-lao",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Yogurt Manager · ລະບົບຈັດການທຸລະກິດໂຢເກີດ",
  description: "ລະບົບບໍລິຫານຮ້ານຝາກຂາຍ, ສະຕັອກ, ການຜະລິດ, ການຊຳລະ ແລະລາຍງານກຳໄລ",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f6ef",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="lo">
      <body className={notoSansLao.variable}><WebVitalsReporter /><AppShell>{children}</AppShell></body>
    </html>
  );
}
