import { DurableObject } from 'cloudflare:workers';
import handler, { UploadBudget as BudgetLogic } from './core.mjs';

// Keep the Worker entrypoint limited to supported exports; helpers stay in core.mjs.
export class UploadBudget extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.budget = new BudgetLogic(ctx, env); }
  fetch(request) { return this.budget.fetch(request); }
}
export default handler;
