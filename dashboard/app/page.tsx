import { redirect } from "next/navigation";

// the home page is the Benchmark list
export default function Home() {
  redirect("/benchmarks");
}
