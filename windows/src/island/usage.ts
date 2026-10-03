// Plan limits of the connected agents (usage.rs), kept in State.usage.
// No timer here: whoever shows the numbers decides when to ask again (Rust
// answers from a 5 s cache, so asking often is cheap).

import { Bridge, type AgentUsage } from "../core/bridge";
import { State } from "../core/state";

/** Reads the limits again and tells the views. Returns what is now in State. */
export async function refreshUsage(): Promise<AgentUsage[]> {
  const usage = await Bridge.usageRead();
  if (usage) {
    State.usage = usage;
    State.notify();
  }
  return State.usage;
}
