import type { Metadata } from "next";
import "./globals.css";
import "./columns.css";
import "./match.css";
import { Tabs } from "@/components/Tabs";

export const metadata: Metadata = {
  title: "LLM Benchmark Results",
  description: "Published LLM benchmark scores collected from public sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
