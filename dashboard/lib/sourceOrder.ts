// Display order of sources in the filters (Source list and Benchmark groups).
// Follows the benchmark list: aggregators first, then knowledge & reasoning, math,
// coding, agentic, human preference, multimodal, long context, classics.
// Sources not listed here come after these, A-Z.
export const SOURCE_ORDER = [
  "LiveBench",                              // 1  LiveBench 2.0
  "Artificial Analysis",                    // 2  Artificial Analysis Intelligence Index
  "BenchLM",                                // 3  BenchLM
  "Humanity's Last Exam (official)",        // 4  HLE
  "MMLU-Pro (TIGER-Lab)",                   // 5  MMLU-Pro
  "GPQA (official repository)",             // 6  GPQA
  "OpenAI simple-evals",                    // 7  SimpleQA (also MMLU, HumanEval)
  "Epoch AI",                               // 9  FrontierMath (also SimpleQA Verified)
  "MathArena (ETH Zurich)",                 // 10 AIME
  "SWE-bench Pro (Scale AI open source)",   // 11 SWE-bench Pro
  "SWE-bench (official)",                   // 11 SWE-bench Verified
  "Aider",                                  // 13 Aider Polyglot
  "Terminal-Bench",                         // 14 Terminal-Bench
  "tau2-bench (Sierra)",                    // 14 τ-bench
  "LMArena",                                // 15 Chatbot Arena
  "WildBench (AI2)",                        // 16 WildBench
  "OCRBench v2",                            // 18 OCRBench v2
  "RULER (NVIDIA)",                         // 19 RULER
  "MMLU (Hendrycks et al.)",                // 24 MMLU (original)
];

const RANK = new Map(SOURCE_ORDER.map((name, i) => [name, i]));

/** compare two source names by SOURCE_ORDER; unknown sources last, A-Z */
export function compareSources(a: string, b: string): number {
  return (RANK.get(a) ?? Infinity) - (RANK.get(b) ?? Infinity) || a.localeCompare(b, "en", { sensitivity: "base" });
}
