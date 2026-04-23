export function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Phase 0</p>
        <h1>Trading Dashboard</h1>
        <p className="lede">
          Local crypto trading bot workspace is online. Backend health endpoint
          and frontend shell are ready for the next phase.
        </p>
        <div className="status-card">
          <span className="status-dot" />
          <span>Server expected at http://localhost:3001/health</span>
        </div>
      </section>
    </main>
  );
}
