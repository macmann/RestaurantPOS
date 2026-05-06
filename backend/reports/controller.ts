import type { AuthenticatedUser } from '../auth/policies';
import {
  getFinancialSummaryReport,
  getInventoryUsageReport,
  getSalesReport,
  type ReportFilters,
  type SalesPeriod,
} from './service';

export const ReportsApi = {
  salesByDay: (user: AuthenticatedUser, filters?: ReportFilters) => getSalesReport(user, 'day', filters),
  salesByWeek: (user: AuthenticatedUser, filters?: ReportFilters) => getSalesReport(user, 'week', filters),
  salesByMonth: (user: AuthenticatedUser, filters?: ReportFilters) => getSalesReport(user, 'month', filters),
  sales: (user: AuthenticatedUser, period: SalesPeriod, filters?: ReportFilters) => getSalesReport(user, period, filters),
  inventoryUsage: (user: AuthenticatedUser, filters?: ReportFilters) => getInventoryUsageReport(user, filters),
  financialSummary: (user: AuthenticatedUser, filters?: ReportFilters) => getFinancialSummaryReport(user, filters),
};
