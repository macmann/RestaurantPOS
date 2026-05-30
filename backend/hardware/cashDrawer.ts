export interface CashDrawerOpenRequest {
  branchId: string;
  tableSessionId: string;
  splitLabel: string;
  billId: string;
  paymentId: string;
  actorUserId: string;
  amount: number;
  reason: 'cash_payment' | 'cash_refund' | 'no_sale';
}

export interface CashDrawerOpenResult {
  eventId: string;
  drawerId: string;
  openedAt: string;
  acknowledged: boolean;
}

export interface CashDrawerAdapter {
  readonly id: string;
  open(request: CashDrawerOpenRequest): Promise<CashDrawerOpenResult>;
}

export class SimulatorCashDrawerAdapter implements CashDrawerAdapter {
  readonly id = 'simulator-cash-drawer';
  readonly openEvents: Array<CashDrawerOpenRequest & CashDrawerOpenResult> = [];

  async open(request: CashDrawerOpenRequest): Promise<CashDrawerOpenResult> {
    const result: CashDrawerOpenResult = {
      eventId: `sim_drawer_${this.openEvents.length + 1}`,
      drawerId: this.id,
      openedAt: new Date().toISOString(),
      acknowledged: true,
    };
    this.openEvents.push(structuredClone({ ...request, ...result }));
    return structuredClone(result);
  }
}

let cashDrawerAdapter: CashDrawerAdapter = new SimulatorCashDrawerAdapter();

export function getCashDrawerAdapter(): CashDrawerAdapter {
  return cashDrawerAdapter;
}

export function setCashDrawerAdapter(adapter: CashDrawerAdapter): void {
  cashDrawerAdapter = adapter;
}

export function resetCashDrawerAdapter(): SimulatorCashDrawerAdapter {
  const adapter = new SimulatorCashDrawerAdapter();
  cashDrawerAdapter = adapter;
  return adapter;
}
