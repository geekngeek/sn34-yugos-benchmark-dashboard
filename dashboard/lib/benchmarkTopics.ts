// Topics for the Benchmark list's category filter: what a (sub-)benchmark tests, so one choice ("Coding")
// finds matching sub-benchmarks across every benchmark. The list's own "Category" column is not used: for
// sub-benchmarks it describes the source's site structure ("English tasks", "Filter preset on Verified …").
// A sub-benchmark gets its topics from its name; if the name says nothing, from its focus; else from its
// parent benchmark. A row can have several topics (Bio/Med -> Science + Health).

export interface Topic { id: string; label: string; rx: RegExp }

export const TOPICS: Topic[] = [
  { id: "coding", label: "Coding", rx: /\bcod(e|ing|er)\b|programming|software|\bswe\b|swe-|bug|repo|terminal|shell|livecodebench|humaneval|aider|refactor|self-repair|test output|code generation|code execution|webdev|systems engineering|performance optimi|hard fixes|llm api|agent loop|cloud infrastructure|scicode/i },
  { id: "math", label: "Math", rx: /\bmath|aime|gsm8k|frontiermath|arithmetic|calculation|algebra|olympiad|erdős|erdos|amc\b|competition math/i },
  { id: "reasoning", label: "Reasoning & puzzles", rx: /reasoning|\blogic|puzzle|zebra|spatial|theory of mind|arc-agi|abstract|navigation|critpt/i },
  { id: "science", label: "Science", rx: /(?<!social )science|biology|physics|chemistry|gpqa|bio\/med|\bstem\b|engineering/i },
  { id: "knowledge", label: "Knowledge & QA", rx: /knowledge|mmlu|trivia|humanities|history|philosophy|psychology|social sciences|\bhle\b|humanity'?s last exam|expert|question answering|\bqa\b|economics|business|\bother\b/i },
  { id: "agentic", label: "Agentic & tool use", rx: /agent|agentic|tool|browser|\bweb\b|τ|tau|gaia|operations|workflow|automation|long-horizon|long-run|enterprise|delegated|sequential planning|data aggregation|commerce|apps\b|intake|when2call|briefcase|paperclip|itbench|analystagent/i },
  { id: "long_context", label: "Long context", rx: /long context|context length|ruler|mrcr|needle|niah|\b\d+k\b|retrieval|variable_tracking|multi-hop|aggregation|\blcr\b|mlcr/i },
  { id: "vision", label: "Vision & documents", rx: /vision|image|video|multimodal|mmmu|ocr|document|pdf|chart|visual|text recognition|text spotting|text referring|element parsing|relation extraction|\b3d\b|docx|\bppt\b|presentation/i },
  { id: "instruction", label: "Instruction following", rx: /instruction|ifbench|\bif\b|constraint adherence|structural integrity/i },
  { id: "multilingual", label: "Multilingual", rx: /multilingual|chinese|global-mmlu|translation|non-english/i },
  { id: "safety", label: "Safety & honesty", rx: /honest|honesty|\bmask\b|safety|hallucinat|disinformation|fabricated|doubling down|deception|omniscience|known facts|situation-provided|continuations|\bsafe|cyber|\bcwe\b|exploit|security|deepsec/i },
  { id: "health", label: "Health & medical", rx: /health|medical|clinical|bio\/med|emergency|context seeking|expertise-tailored|response depth|responding under uncertainty|global health/i },
  { id: "finance", label: "Finance & economics", rx: /financ|economics|\btax\b|accounting|business|\bgdp\b|financebench|metrics-generated|novel-generated|domain-relevant/i },
  { id: "legal", label: "Legal", rx: /legal|\blaw\b|rule-|issue-spotting|interpretation|rhetorical|regulatory|compliance|harvey/i },
  { id: "preference", label: "Human preference & chat", rx: /arena|\belo\b|preference|vote|wildbench|wb-|creative|\bchat\b|reward|planning & reasoning|information\/advice|text-to-|image edit|video edit|image-to/i },
  { id: "factuality", label: "Factuality & search", rx: /factual|facts|grounding|search|parametric|simpleqa|hallucination/i },
  { id: "research", label: "Research & writing", rx: /research|report|writing|strategy|science & evidence|\bdesign\b/i },
];
export const TOPIC_LABEL: Record<string, string> = Object.fromEntries(TOPICS.map((t) => [t.id, t.label]));

const match = (text: string) => TOPICS.filter((t) => t.rx.test(text)).map((t) => t.id);

/** a parent benchmark's topics: its name, category and focus */
export function parentTopics(p: { name: string; category: string; focus: string }): string[] {
  return match(`${p.name} ${p.category} ${p.focus}`);
}

/** a sub-benchmark's topics and where they came from */
export function subTopics(c: { name: string; focus: string }, parent: { name: string; category: string; focus: string }):
    { topics: string[]; from: "name" | "focus" | "parent" } {
  const byName = match(c.name);
  if (byName.length) return { topics: byName, from: "name" };
  const byFocus = match(c.focus);
  if (byFocus.length) return { topics: byFocus, from: "focus" };
  return { topics: parentTopics(parent), from: "parent" };
}
