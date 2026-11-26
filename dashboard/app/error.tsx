"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page">
      <div className="card">
        <h1>Couldn&apos;t load the results</h1>
        <p className="subtle" style={{ margin: "8px 0 16px" }}>
          The benchmark API did not respond. Check that it is running on port 8010, then retry.
        </p>
        <button className="button primary" onClick={reset}>Retry</button>
      </div>
    </main>
  );
}
