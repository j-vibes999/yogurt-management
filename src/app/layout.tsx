import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Noto_Sans_Lao } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import "./professional.css";
import "./workspace-colors.css";

const notoSansLao = Noto_Sans_Lao({
  subsets: ["lao", "latin"],
  variable: "--font-lao",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Yogurt Manager · ລະບົບບໍລິຫານໂຢເກີດ",
  description: "ລະບົບຈັດການຮ້ານຝາກຂາຍ, ສະຕັອກ, ການຜະລິດ ແລະການເງິນ",
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
      <body className={notoSansLao.variable}><AppShell>{children}</AppShell></body>
    </html>
  );
}
