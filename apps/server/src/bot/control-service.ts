const STRATEGIES = ["all", "ma-crossover", "breakout", "mean-reversion", "caveman-trend-pullback"] as const;

export type BotStrategy = (typeof STRATEGIES)[number];

export interface BotState {
  running: boolean;
  activeStrategy: BotStrategy;
  killSwitchActive: boolean;
  killSwitchReason: string | null;
}

export class BotControlService {
  private state: BotState = {
    running: true,
    activeStrategy: "all",
    killSwitchActive: false,
    killSwitchReason: null
  };

  getState(): BotState {
    return { ...this.state };
  }

  start() {
    this.state.running = true;
    this.state.killSwitchActive = false;
    this.state.killSwitchReason = null;
    return this.getState();
  }

  stop() {
    this.state.running = false;
    return this.getState();
  }

  setStrategy(strategy: BotStrategy) {
    this.state.activeStrategy = strategy;
    return this.getState();
  }

  tripKillSwitch(reason: string) {
    this.state.running = false;
    this.state.killSwitchActive = true;
    this.state.killSwitchReason = reason;
    return this.getState();
  }

  allowsStrategy(strategy: string) {
    return this.state.running && (this.state.activeStrategy === "all" || this.state.activeStrategy === strategy);
  }

  isValidStrategy(value: string): value is BotStrategy {
    return (STRATEGIES as readonly string[]).includes(value);
  }

  listStrategies(): readonly BotStrategy[] {
    return STRATEGIES;
  }
}
