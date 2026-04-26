import { memo, startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type BotStrategy = "all" | "ma-crossover" | "breakout" | "mean-reversion" | "caveman-trend-pullback";

interface ReplayState {
  csvPath: string | null;
  loaded: boolean;
  running: boolean;
  completed: boolean;
  processedCandles: number;
  totalCandles: number;
  currentOpenTime: number | null;
  intervalMs: number;
  lastError: string | null;
}

interface StatusResponse {
  status: string;
  mode: string;
  liveEnabled: boolean;
  database: { path: string };
  market: { symbol: string; enabled: boolean };
  bot: { running: boolean; activeStrategy: BotStrategy };
  strategies: BotStrategy[];
  replay?: ReplayState;
}

interface PriceResponse {
  symbol: string;
  price: {
    symbol: string;
    price: number;
    source: string;
    eventTime: number;
    receivedAt: string;
  } | null;
}

interface Candle {
  id: number;
  symbol: string;
  timeframe: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandlesResponse {
  symbol: string;
  timeframe: string;
  candles: Candle[];
}

interface Signal {
  id: number;
  symbol: string;
  strategy: string;
  candleId: number | null;
  side: string;
  reason: string;
  createdAt: string;
}

interface SignalsResponse {
  symbol: string;
  signals: Signal[];
}

interface Trade {
  id: number;
  orderId: number | null;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
}

interface TradesResponse {
  symbol: string;
  trades: Trade[];
}

interface Order {
  id: number;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  price: number | null;
  status: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

interface OrdersResponse {
  symbol: string;
  orders: Order[];
}

interface Position {
  symbol: string;
  quantity: number;
  averagePrice: number;
  realizedPnl: number;
}

interface PositionResponse {
  symbol: string;
  position: Position | null;
}

interface ExecutionAnalyticsSummary {
  totalTrades: number;
  completedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  totalVolume: number;
  totalFees: number;
  grossPnl: number;
  netPnl: number;
  netReturnPct: number;
  averageWin: number;
  averageLoss: number;
  averageRisk: number;
  profitFactor: number | null;
  maxDrawdown: number;
  currentOpenQuantity: number;
  currentAveragePrice: number;
  estimatedOpenRisk: number;
}

interface AnalyticsResponse {
  symbol: string;
  analytics: ExecutionAnalyticsSummary;
}

interface BotResponse {
  bot: {
    running: boolean;
    activeStrategy: BotStrategy;
  };
  strategies?: BotStrategy[];
}

interface DashboardState {
  status: StatusResponse | null;
  price: PriceResponse | null;
  candles: CandlesResponse | null;
  signals: SignalsResponse | null;
  trades: TradesResponse | null;
  orders: OrdersResponse | null;
  position: PositionResponse | null;
  analytics: AnalyticsResponse | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function App() {
  const [data, setData] = useState<DashboardState>({
    status: null,
    price: null,
    candles: null,
    signals: null,
    trades: null,
    orders: null,
    position: null,
    analytics: null
  });
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const isReplayMode = data.status?.mode === "replay";

  useEffect(() => {
    let cancelled = false;

    async function loadLiveData() {
      try {
        const [status, price, signals, trades, orders, position, analytics] = await Promise.all([
          fetchJson<StatusResponse>("/api/v1/status"),
          fetchJson<PriceResponse>("/api/v1/market/price"),
          fetchJson<SignalsResponse>("/api/v1/signals?limit=12"),
          fetchJson<TradesResponse>("/api/v1/execution/trades?limit=12"),
          fetchJson<OrdersResponse>("/api/v1/execution/orders?limit=12"),
          fetchJson<PositionResponse>("/api/v1/execution/positions"),
          fetchJson<AnalyticsResponse>("/api/v1/execution/analytics")
        ]);

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setData((current) => ({
            ...current,
            status,
            price,
            signals,
            trades,
            orders,
            position,
            analytics
          }));
          setError(null);
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Dashboard failed to load");
        }
      }
    }

    void loadLiveData();
    const timer = setInterval(() => {
      void loadLiveData();
    }, isReplayMode ? 1500 : 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isReplayMode]);

  useEffect(() => {
    let cancelled = false;

    async function loadCandles() {
      try {
        const candles = await fetchJson<CandlesResponse>("/api/v1/market/candles?limit=20");

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setData((current) => ({
            ...current,
            candles
          }));
          setError(null);
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Candle chart failed to load");
        }
      }
    }

    void loadCandles();
    const timer = setInterval(() => {
      void loadCandles();
    }, isReplayMode ? 1500 : 8000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isReplayMode]);

  const deferredCandles = useDeferredValue(data.candles?.candles ?? []);
  const chartData = useMemo(() => {
    const candles = [...deferredCandles].reverse();
    return candles.map((candle) => ({
      time: formatTime(candle.openTime),
      open: candle.open,
      close: candle.close,
      high: candle.high,
      low: candle.low,
      volume: Number(candle.volume.toFixed(3))
    }));
  }, [deferredCandles]);

  const latestPrice = data.price?.price?.price ?? null;
  const position = data.position?.position ?? null;
  const replay = data.status?.replay ?? null;
  const analytics = data.analytics?.analytics ?? null;
  const unrealizedPnl =
    latestPrice !== null && position && position.quantity !== 0
      ? Number(((latestPrice - position.averagePrice) * position.quantity).toFixed(2))
      : null;

  async function runBotAction(path: string, body?: object) {
    setBusyAction(path);
    setError(null);

    try {
      await fetchJson<BotResponse>(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined
      });

      const [status, signals, trades, orders, position, analytics] = await Promise.all([
        fetchJson<StatusResponse>("/api/v1/status"),
        fetchJson<SignalsResponse>("/api/v1/signals?limit=12"),
        fetchJson<TradesResponse>("/api/v1/execution/trades?limit=12"),
        fetchJson<OrdersResponse>("/api/v1/execution/orders?limit=12"),
        fetchJson<PositionResponse>("/api/v1/execution/positions"),
        fetchJson<AnalyticsResponse>("/api/v1/execution/analytics")
      ]);

      startTransition(() => {
        setData((current) => ({
          ...current,
          status,
          signals,
          trades,
          orders,
          position,
          analytics
        }));
      });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="dashboard-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Phase 10</p>
          <h1>Trading Dashboard</h1>
          <p className="lede">
            Live market, replay practice, strategy output, paper execution, and bot controls in one
            place.
          </p>
          <div className="mode-row">
            <span className={`mode-chip mode-${data.status?.mode ?? "paper"}`}>
              {formatModeLabel(data.status?.mode ?? "paper")}
            </span>
            {isReplayMode && replay ? (
              <span className="mode-detail">
                {replay.completed
                  ? `Replay complete: ${replay.processedCandles}/${replay.totalCandles} candles`
                  : `Replay progress: ${replay.processedCandles}/${replay.totalCandles} candles`}
              </span>
            ) : (
              <span className="mode-detail">
                {data.status?.market.enabled ? "Connected to live market data" : "Market data disabled"}
              </span>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="primary-button"
            disabled={busyAction !== null || data.status?.bot.running === true}
            onClick={() => void runBotAction("/api/v1/bot/start")}
          >
            Start Bot
          </button>
          <button
            className="ghost-button"
            disabled={busyAction !== null || data.status?.bot.running === false}
            onClick={() => void runBotAction("/api/v1/bot/stop")}
          >
            Stop Bot
          </button>
          {isReplayMode ? (
            <button
              className="ghost-button"
              disabled={busyAction !== null || replay?.running === true}
              onClick={() => void runBotAction("/api/v1/replay/start")}
            >
              Start Replay
            </button>
          ) : null}
          {isReplayMode ? (
            <button
              className="ghost-button"
              disabled={busyAction !== null || replay?.running === false}
              onClick={() => void runBotAction("/api/v1/replay/stop")}
            >
              Stop Replay
            </button>
          ) : null}
          <select
            className="strategy-select"
            disabled={busyAction !== null}
            value={data.status?.bot.activeStrategy ?? "all"}
            onChange={(event) =>
              void runBotAction("/api/v1/bot/strategy", {
                strategy: event.target.value
              })
            }
          >
            {(data.status?.strategies ?? ["all"]).map((strategy) => (
              <option key={strategy} value={strategy}>
                {formatStrategy(strategy)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {isReplayMode && replay ? (
        <section className="practice-panel">
          <div>
            <p className="practice-label">Practice Session</p>
            <h2>{replay.running ? "Replay is running" : replay.completed ? "Replay completed" : "Replay is ready"}</h2>
            <p className="practice-copy">
              Use this mode to practice reading candles and watching signals, orders, trades, and
              PnL update without waiting on Binance.
            </p>
          </div>
          <div className="practice-stats">
            <PracticeStat label="Candles" value={`${replay.processedCandles}/${replay.totalCandles}`} />
            <PracticeStat
              label="Speed"
              value={replay.intervalMs === 0 ? "Instant" : `${replay.intervalMs} ms`}
            />
            <PracticeStat
              label="Current Candle"
              value={replay.currentOpenTime ? formatTime(replay.currentOpenTime) : "Waiting"}
            />
            <PracticeStat
              label="Data File"
              value={replay.csvPath ? trimPath(replay.csvPath) : "Not loaded"}
            />
          </div>
        </section>
      ) : null}

      <section className="stats-grid">
        <StatCard
          label={isReplayMode ? "Practice Bot" : "Bot"}
          value={data.status?.bot.running ? "Running" : "Stopped"}
          detail={`Strategy: ${formatStrategy(data.status?.bot.activeStrategy ?? "all")}`}
        />
        <StatCard
          label="Price"
          value={latestPrice === null ? "Waiting" : `$${latestPrice.toLocaleString()}`}
          detail={
            data.price?.price
              ? `Source: ${data.price.price.source}`
              : isReplayMode
                ? "Waiting for replay price"
                : "No live price yet"
          }
        />
        <StatCard
          label="Signals"
          value={String(data.signals?.signals.length ?? 0)}
          detail={data.signals?.signals[0] ? `Latest: ${data.signals.signals[0].strategy}` : "No signals yet"}
        />
        <StatCard
          label="Realized PnL"
          value={analytics ? formatMoney(analytics.netPnl) : position ? formatMoney(position.realizedPnl) : "$0.00"}
          detail={unrealizedPnl !== null ? `Unrealized: ${formatMoney(unrealizedPnl)}` : "No open position"}
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>1m Candles</h2>
              <p>
                {data.status?.market.symbol ?? "BTCUSDT"} close, range, and volume
                {isReplayMode ? " from replay practice data" : ""}
              </p>
            </div>
          </div>
          <div className="chart-wrap">
            <CandleChart data={chartData} />
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Execution Snapshot</h2>
              <p>{isReplayMode ? "Current replay position and latest fills" : "Current paper position and latest fills"}</p>
            </div>
          </div>
          <div className="snapshot-grid">
            <SnapshotItem label="Quantity" value={position ? String(position.quantity) : "0"} />
            <SnapshotItem
              label="Average Price"
              value={position && position.quantity !== 0 ? `$${position.averagePrice.toLocaleString()}` : "Flat"}
            />
            <SnapshotItem
              label="Realized PnL"
              value={position ? formatMoney(position.realizedPnl) : "$0.00"}
            />
            <SnapshotItem
              label="Unrealized PnL"
              value={unrealizedPnl !== null ? formatMoney(unrealizedPnl) : "N/A"}
            />
          </div>
          <MiniTable
            title="Recent Trades"
            columns={["Time", "Side", "Price", "Fee"]}
            rows={(data.trades?.trades ?? []).slice(0, 5).map((trade) => [
              formatClock(trade.executedAt),
              trade.side.toUpperCase(),
              `$${trade.price.toLocaleString()}`,
              formatMoney(-trade.fee)
            ])}
          />
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Performance Summary</h2>
              <p>Net return, fees, risk, and drawdown for completed replay trades</p>
            </div>
          </div>
          <div className="snapshot-grid">
            <SnapshotItem
              label="Completed Trades"
              value={analytics ? String(analytics.completedTrades) : "0"}
            />
            <SnapshotItem
              label="Win Rate"
              value={analytics ? `${analytics.winRatePct.toFixed(2)}%` : "0.00%"}
            />
            <SnapshotItem
              label="Net Return"
              value={analytics ? `${analytics.netReturnPct.toFixed(2)}%` : "0.00%"}
            />
            <SnapshotItem
              label="Fees Paid"
              value={analytics ? formatMoney(-analytics.totalFees) : "$0.00"}
            />
            <SnapshotItem
              label="Avg Risk"
              value={analytics ? formatMoney(-analytics.averageRisk) : "$0.00"}
            />
            <SnapshotItem
              label="Max Drawdown"
              value={analytics ? formatMoney(-analytics.maxDrawdown) : "$0.00"}
            />
          </div>
          <MiniTable
            title="Evaluation Metrics"
            columns={["Metric", "Value", "Meaning"]}
            rows={
              analytics
                ? [
                    ["Gross PnL", formatMoney(analytics.grossPnl), "Before fees"],
                    ["Net PnL", formatMoney(analytics.netPnl), "After fees"],
                    [
                      "Profit Factor",
                      analytics.profitFactor === null ? "All wins" : analytics.profitFactor.toFixed(2),
                      "Gross wins divided by gross losses"
                    ],
                    ["Total Volume", `$${analytics.totalVolume.toFixed(2)}`, "Total notional traded"],
                    [
                      "Open Risk",
                      formatMoney(-analytics.estimatedOpenRisk),
                      "Estimated stop-loss exposure on any open trade"
                    ]
                  ]
                : []
            }
          />
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Signals</h2>
              <p>Most recent strategy outputs</p>
            </div>
          </div>
          <MiniTable
            title="Latest Signals"
            columns={["Strategy", "Side", "Reason"]}
            rows={(data.signals?.signals ?? []).slice(0, 6).map((signal) => [
              formatStrategy(signal.strategy),
              signal.side.toUpperCase(),
              signal.reason
            ])}
          />
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Orders</h2>
              <p>{isReplayMode ? "Replay orders generated from signals" : "Paper orders generated from signals"}</p>
            </div>
          </div>
          <MiniTable
            title="Latest Orders"
            columns={["Side", "Price", "Status", "Mode"]}
            rows={(data.orders?.orders ?? []).slice(0, 6).map((order) => [
              order.side.toUpperCase(),
              order.price === null ? "Market" : `$${order.price.toLocaleString()}`,
              order.status,
              order.mode
            ])}
          />
        </article>
      </section>
    </main>
  );
}

const CandleChart = memo(function CandleChart(props: {
  data: Array<{
    time: string;
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
  }>;
}) {
  if (props.data.length === 0) {
    return <div className="chart-empty">Waiting for candle data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={props.data}>
        <CartesianGrid stroke="rgba(241,234,220,0.08)" vertical={false} />
        <XAxis dataKey="time" stroke="#c9baa3" tickLine={false} axisLine={false} />
        <YAxis
          yAxisId="price"
          stroke="#c9baa3"
          tickLine={false}
          axisLine={false}
          width={76}
          domain={["dataMin", "dataMax"]}
        />
        <YAxis yAxisId="volume" hide />
        <Tooltip
          isAnimationActive={false}
          contentStyle={{
            background: "#09111a",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 14
          }}
        />
        <Bar
          yAxisId="volume"
          dataKey="volume"
          fill="rgba(255,184,107,0.18)"
          radius={[6, 6, 0, 0]}
          isAnimationActive={false}
        />
        <Area
          yAxisId="price"
          type="monotone"
          dataKey="close"
          stroke="#ffb86b"
          fill="url(#priceFill)"
          strokeWidth={2.5}
          isAnimationActive={false}
        />
        <Line
          yAxisId="price"
          type="monotone"
          dataKey="high"
          stroke="#7ee787"
          dot={false}
          strokeWidth={1.2}
          isAnimationActive={false}
        />
        <Line
          yAxisId="price"
          type="monotone"
          dataKey="low"
          stroke="#ff7b72"
          dot={false}
          strokeWidth={1.2}
          isAnimationActive={false}
        />
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ffb86b" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#ffb86b" stopOpacity={0.02} />
          </linearGradient>
        </defs>
      </ComposedChart>
    </ResponsiveContainer>
  );
});

function StatCard(props: { label: string; value: string; detail: string }) {
  return (
    <article className="stat-card">
      <span className="stat-label">{props.label}</span>
      <strong className="stat-value">{props.value}</strong>
      <span className="stat-detail">{props.detail}</span>
    </article>
  );
}

function SnapshotItem(props: { label: string; value: string }) {
  return (
    <div className="snapshot-item">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function PracticeStat(props: { label: string; value: string }) {
  return (
    <div className="practice-stat">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function MiniTable(props: { title: string; columns: string[]; rows: string[][] }) {
  return (
    <div className="mini-table">
      <h3>{props.title}</h3>
      <div className="table-head">
        {props.columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      {props.rows.length > 0 ? (
        props.rows.map((row, index) => (
          <div key={`${props.title}-${index}`} className="table-row">
            {row.map((cell, cellIndex) => (
              <span key={`${props.title}-${index}-${cellIndex}`}>{cell}</span>
            ))}
          </div>
        ))
      ) : (
        <div className="empty-state">Waiting for data</div>
      )}
    </div>
  );
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatMoney(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
}

function formatStrategy(strategy: string) {
  return strategy
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatModeLabel(mode: string) {
  return mode === "replay" ? "Replay Practice" : mode.charAt(0).toUpperCase() + mode.slice(1);
}

function trimPath(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.slice(-2).join("/");
}
