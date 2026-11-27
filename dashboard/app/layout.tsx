import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./columns.css";
import "./system.css";
import "./match.css";
import { Tabs } from "@/components/Tabs";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "LLM Benchmark Results",
  description: "Published LLM benchmark scores collected from public sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <Tabs />
        {children}
        <footer className="footer">
          Scores are published results from public sources, not our own evaluations. Data:{" "}
          <a href="https://livebench.ai">LiveBench</a>,{" "}
          <a href="https://artificialanalysis.ai/">Artificial Analysis</a>, and{" "}
          <a href="https://benchlm.ai/">BenchLM.ai</a> (BenchLM data licensed{" "}
          <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>).
        </footer>
      </body>
    </html>
  );
}
