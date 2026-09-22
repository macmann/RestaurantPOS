import type { AuthenticatedUser } from '../auth/policies';
import { can } from '../auth/policies';
import { Actions, type Action } from '../auth/permissions';
import { recordAuditEvent } from '../audit/service';
import {
  getFinancialSummaryReport,
  getDailySummaryReport,
  getInventoryUsageReport,
  getSalesReport,
  getExceptionReport,
  getStationReport,
  getProductMixReport,
  getInventoryControlReport,
  getStockValuationReport,
  getRestockHistoryReport,
  getWastageReport,
  getUsageVarianceReport,
  getOperationsReport,
  type ReportFilters,
  type SalesPeriod,
} from './service';

async function auditedView<T>(user: AuthenticatedUser, reportId: string, filters: ReportFilters | undefined, load: () => Promise<T>): Promise<T> {
  const report = await load();
  await recordAuditEvent({ action: 'report_viewed', actor: user, entity: { type: 'report', id: reportId }, metadata: { filters: filters ?? {} } });
  return report;
}

export const ReportsApi = {
  salesByDay: (user: AuthenticatedUser, filters?: ReportFilters) => getSalesReport(user, 'day', filters),
  salesByWeek: (user: AuthenticatedUser, filters?: ReportFilters) => getSalesReport(user, 'week', filters),
  salesByMonth: (user: AuthenticatedUser, filters?: ReportFilters) => getSalesReport(user, 'month', filters),
  sales: (user: AuthenticatedUser, period: SalesPeriod, filters?: ReportFilters) => getSalesReport(user, period, filters),
  inventoryUsage: (user: AuthenticatedUser, filters?: ReportFilters) => getInventoryUsageReport(user, filters),
  financialSummary: (user: AuthenticatedUser, filters?: ReportFilters) => auditedView(user, 'financial_summary', filters, () => getFinancialSummaryReport(user, filters)),
  dailySummary: (user: AuthenticatedUser, filters?: ReportFilters) => getDailySummaryReport(user, filters),
  exceptions: (user: AuthenticatedUser, filters?: ReportFilters) => auditedView(user, 'exception_report', filters, () => getExceptionReport(user, filters)),
  stations: (user: AuthenticatedUser, filters?: ReportFilters) => getStationReport(user, filters),
  productMix: (user: AuthenticatedUser, filters?: ReportFilters) => getProductMixReport(user, filters),
  inventoryControl: (user: AuthenticatedUser, filters?: ReportFilters) => auditedView(user, 'inventory_control', filters, () => getInventoryControlReport(user, filters)),
  stockValuation: (user: AuthenticatedUser, filters?: ReportFilters) => auditedView(user, 'stock_valuation', filters, () => getStockValuationReport(user, filters)),
  restockHistory: (user: AuthenticatedUser, filters?: ReportFilters) => auditedView(user, 'restock_history', filters, () => getRestockHistoryReport(user, filters)),
  wastage: (user: AuthenticatedUser, filters?: ReportFilters) => auditedView(user, 'wastage', filters, () => getWastageReport(user, filters)),
  usageVariance: (user: AuthenticatedUser, filters?: ReportFilters) => auditedView(user, 'usage_variance', filters, () => getUsageVarianceReport(user, filters)),
  operations: (user: AuthenticatedUser, filters?: ReportFilters) => auditedView(user, 'operations', filters, () => getOperationsReport(user, filters)),
  auditExport: async (user: AuthenticatedUser, reportId: string, format: 'csv' | 'print', filters: ReportFilters = {}) => {
    const requiredPermissions: Record<string, Action> = {
      financial_summary: Actions.ViewFinancialReports,
      operations: Actions.ViewEmployeePerformanceReports,
      exception_report: Actions.ViewVoidReports,
      inventory_control: Actions.ViewInventoryCostReports,
      stock_valuation: Actions.ViewInventoryCostReports,
      restock_history: Actions.ViewInventoryCostReports,
      wastage: Actions.ViewInventoryCostReports,
      usage_variance: Actions.ViewInventoryCostReports,
    };
    const permission = requiredPermissions[reportId] ?? Actions.ViewReports;
    if (!can(user, permission)) throw new Error('Forbidden: cannot export this report.');
    await recordAuditEvent({ action: 'report_exported', actor: user, entity: { type: 'report', id: reportId }, metadata: { format, filters } });
    return { recorded: true };
  },
};
