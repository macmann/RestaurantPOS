import type { AuthenticatedUser } from '../auth/policies';
import {
  getFinancialSummaryReport,
  getDailySummaryReport,
  getInventoryUsageReport,
  getSalesReport,
  getExceptionReport,
  getStationReport,
  getProductMixReport,
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
  dailySummary: (user: AuthenticatedUser, filters?: ReportFilters) => getDailySummaryReport(user, filters),
  exceptions: (user: AuthenticatedUser, filters?: ReportFilters) => getExceptionReport(user, filters),
  stations: (user: AuthenticatedUser, filters?: ReportFilters) => getStationReport(user, filters),
  productMix: (user: AuthenticatedUser, filters?: ReportFilters) => getProductMixReport(user, filters),
};
