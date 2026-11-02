import type { Metadata } from "next";
import { Outfit, Spline_Sans_Mono } from "next/font/google";
import { SCRIPT_TEMA } from "@/lib/tema";
import "./globals.css";

const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });
const splineMono = Spline_Sans_Mono({ variable: "--font-spline-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Novo Aluguel", template: "%s · Novo Aluguel" },
  description: "Gestão de locação de imóveis: contratos, cobranças, repasses e reajustes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${outfit.variable} ${splineMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full bg-app text-texto">{children}</body>
    </html>
  );
}
