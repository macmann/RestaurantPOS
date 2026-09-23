import { getStoredSession, login, logout, type BrowserSession } from '../auth/session';
import { appRoutes, canAccessRoute, defaultRoute, superadminSettingsRoutes, visibleRoutes, type AppRoute } from '../auth/navigation';
import type { AuthenticatedUser } from '../../backend/auth/policies';
import { Actions, RolePermissions, type Action } from '../../backend/auth/permissions';
import { loadOrderProgressForWaiter } from '../waiter/order-progress';
import { buildMenuItemAddition, orderItemPreparationStatus } from '../orders/order-screen';
import { loadAdminMenuDashboard } from '../admin/menu-management';
import { loadAdminAuditViewer } from '../admin/audit-viewer';
import { ApiClientError, apiClient, type PrinterStatus, type SystemStatus } from '../api/client';
import { loadCashierTableFloor } from '../cashier/table-floor';
import { closePaidTableFromBillingScreen } from '../billing/billing-screen';
import type { OrderRecord, OrderStatus } from '../../backend/orders/repository';
import type { KdsSnapshot } from '../../backend/kds/service';
import type { TableFloorState } from '../../backend/tables/service';
import type { ReceiptPayload, SplitLabel, TableOrderItem } from '../../backend/billing/repository';
import { buildLocaleSwitchState, getLocaleResource, getTypographyForLocale, listLocaleOptions, normalizeLocale, setActiveLocale, verifyUnicodeCompatibility } from '../i18n/locale-switcher';
import { buildEnglishMyanmarLocalizationMap, listEnglishMyanmarTranslationEntries, type EnglishMyanmarTranslationEntry, type SupportedLocale } from '../../backend/i18n/resources';
import { getBusinessDayRange } from '../../shared/business-day';
import { downloadReportCsv, printReport } from '../reports/export';

const APP_NAME = 'SYM POS';

interface SuperadminPrinterSettings {
  enabled: boolean;
  printerId: string;
  displayName: string;
  connectionType: 'simulator' | 'network' | 'windows';
  windowsPrinterName?: string;
  networkAddress?: string;
  networkPort: number;
  copies: number;
  autoPrint: boolean;
}

interface RestaurantBillInfo {
  restaurantName: string;
  address: string;
  contact: string;
  taxId?: string;
  receiptFooter?: string;
}

interface SuperadminPrepStation {
  id: string;
  displayName: string;
  enabled: boolean;
  sortOrder: number;
}

interface SuperadminOperationalSettings {
  menuInventoryLinkEnabled: boolean;
  restaurantBillInfo: RestaurantBillInfo;
  prepStations: SuperadminPrepStation[];
  printers: Record<string, SuperadminPrinterSettings> & {
    receipt: SuperadminPrinterSettings;
  };
  printerAssignments: Record<string, string>;
  tax: {
    enabled: boolean;
    rate: number;
  };
  localization: {
    defaultLocale: SupportedLocale;
    englishToMyanmar: Record<string, string>;
  };
}

interface RuntimeSettingsResponse {
  branch?: {
    branchName?: string;
    address?: string;
    contactNumber?: string;
    timezone?: string;
    businessDayCutoff?: string;
  };
  pos?: Partial<SuperadminOperationalSettings>;
  restaurantBillInfo?: Partial<RestaurantBillInfo>;
  printers?: Partial<Record<string, Partial<SuperadminPrinterSettings>>>;
  localization?: Partial<SuperadminOperationalSettings['localization']>;
}

async function loadCurrentBusinessDayRange(): Promise<{ dateFrom: string; dateTo: string; businessDate: string }> {
  const settings = await apiClient.getSettings() as RuntimeSettingsResponse;
  return getBusinessDayRange(new Date(), {
    timezone: settings.branch?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    businessDayCutoff: settings.branch?.businessDayCutoff ?? '00:00',
  });
}

const rootElement = document.querySelector<HTMLDivElement>('#app');
if (!rootElement) throw new Error('App root not found.');
const root = rootElement;

let session: BrowserSession | null = getStoredSession();

function landingRoute(currentSession: BrowserSession | null): AppRoute {
  if (currentSession) {
    const roles = Array.isArray(currentSession.user.role) ? currentSession.user.role : [currentSession.user.role];
    const preferredPath = roles.includes('waitstaff') ? '#/order-station'
      : roles.includes('cashier') ? '#/billing'
        : roles.some((role) => role === 'kitchen' || role === 'bar') ? '#/prep-stations'
          : roles.includes('inventory_clerk') ? '#/inventory-alerts'
            : undefined;
    const preferred = preferredPath ? appRoutes.find((item) => item.path === preferredPath) : undefined;
    if (preferred && canAccessRoute(preferred, currentSession.permissions)) return preferred;
  }
  return defaultRoute(currentSession?.permissions ?? []);
}

let route = window.location.hash || landingRoute(session).path;
let apiStatus = apiClient.getNetworkStatus();
let apiStatusMessage = 'API connection healthy.';
let loginNotice: string | undefined;
let healthTimer: number | undefined;
let selectedTableId: string | undefined;
let selectedSplitCount = 1;
let splitDraftSelections: Record<string, Partial<Record<SplitLabel, TableOrderItem[]>>> = {};
let pendingPrintPreview: { tableSessionId: string; receipt: ReceiptPayload; splitLabel?: SplitLabel } | undefined;
let activeUiLocale: SupportedLocale = normalizeLocale();
let englishToMyanmarUiLabels: Record<string, string> = buildEnglishMyanmarLocalizationMap();
let cachedPrepStations: SuperadminPrepStation[] = normalizePrepStations(undefined);
let sidebarCollapsed = window.localStorage.getItem('sym-pos-sidebar-collapsed') === 'true';
let renderGeneration = 0;

apiClient.onNetworkStatus((status, detail) => {
  apiStatus = status;
  apiStatusMessage = detail?.message ?? (status === 'online' ? 'API connection healthy.' : status === 'degraded' ? 'Retrying API connection…' : 'API unavailable.');
  const banner = document.querySelector<HTMLElement>('.network-banner');
  if (banner) updateNetworkBanner(banner);
});

window.addEventListener('online', () => {
  apiStatus = 'degraded';
  apiStatusMessage = 'Browser is back online; checking the POS API…';
  void apiClient.health();
});
window.addEventListener('offline', () => {
  apiStatus = 'offline';
  apiStatusMessage = 'Browser is offline. Orders and KDS updates are blocked until LAN connectivity returns.';
  const banner = document.querySelector<HTMLElement>('.network-banner');
  if (banner) updateNetworkBanner(banner);
});

window.addEventListener('hashchange', () => {
  route = window.location.hash || landingRoute(session).path;
  render();
});


function translateUiText(value: string): string {
  if (activeUiLocale !== 'my') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const exact = englishToMyanmarUiLabels[trimmed];
  if (exact) return value.replace(trimmed, exact);

  let translated = value;
  const phraseEntries = Object.entries(englishToMyanmarUiLabels)
    .filter(([english]) => english.length > 2 && /[A-Za-z]/.test(english))
    .sort((a, b) => b[0].length - a[0].length);
  for (const [english, myanmar] of phraseEntries) {
    if (!myanmar || !translated.includes(english)) continue;
    const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    translated = translated.replace(new RegExp(`(^|[^A-Za-z])(${escaped})(?=$|[^A-Za-z])`, 'g'), (_match, prefix) => `${prefix}${myanmar}`);
  }
  return translated;
}

function translateUiHtml(value: string): string {
  return escapeHtml(translateUiText(value));
}

function localizeElementText(rootNode: ParentNode): void {
  if (activeUiLocale !== 'my') return;
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'PRE', 'CODE'].includes(parent.tagName)) continue;
    node.textContent = translateUiText(node.textContent ?? '');
  }

  const localizedAttributes = ['aria-label', 'placeholder', 'title'];
  rootNode.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of localizedAttributes) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, translateUiText(value));
    }
  });
}

async function syncApplicationLocale(): Promise<void> {
  try {
    const settings = normalizeOperationalSettings(await apiClient.getSettings());
    activeUiLocale = setActiveLocale(settings.localization.defaultLocale);
    englishToMyanmarUiLabels = { ...buildEnglishMyanmarLocalizationMap(), ...settings.localization.englishToMyanmar };
  } catch {
    activeUiLocale = setActiveLocale(activeUiLocale);
    englishToMyanmarUiLabels = buildEnglishMyanmarLocalizationMap();
  }
  const typography = getTypographyForLocale(activeUiLocale);
  root.style.fontFamily = typography.fontFamily;
  root.dir = typography.direction;
}

function navigate(path: string): void {
  if (window.location.hash === path) render();
  else window.location.hash = path;
}

function routePath(value = route): string {
  return value.split('?')[0];
}

function activeRoute(): AppRoute {
  return appRoutes.find((item) => item.path === routePath()) ?? defaultRoute(session?.permissions ?? []);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type ToastTone = 'loading' | 'success' | 'error';

function showActionToast(message: string, tone: ToastTone, existing?: HTMLElement): HTMLElement {
  let region = document.querySelector<HTMLElement>('.toast-region');
  if (!region) {
    region = el('div', 'toast-region');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-label', 'Action notifications');
    document.body.append(region);
  }

  const toast = existing ?? el('div', 'action-toast');
  toast.className = `action-toast action-toast--${tone}`;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.innerHTML = `${tone === 'loading' ? '<span class="loading-spinner" aria-hidden="true"></span>' : `<span class="action-toast__icon" aria-hidden="true">${tone === 'success' ? '&#10003;' : '!'}</span>`}<span>${escapeHtml(translateUiText(message))}</span>`;
  if (!existing) region.append(toast);
  window.clearTimeout(Number(toast.dataset.dismissTimer));
  if (tone !== 'loading') {
    const timer = window.setTimeout(() => toast.remove(), tone === 'error' ? 6000 : 3500);
    toast.dataset.dismissTimer = String(timer);
  }
  return toast;
}

async function runButtonAction<T>(
  button: HTMLButtonElement,
  messages: { loading: string; success: string; error: string },
  action: () => Promise<T>,
): Promise<T> {
  if (button.dataset.loading === 'true') throw new Error('This action is already being processed.');
  const originalMarkup = button.innerHTML;
  const wasDisabled = button.disabled;
  button.dataset.loading = 'true';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.classList.add('button-loading');
  button.innerHTML = `<span class="loading-spinner" aria-hidden="true"></span><span>${escapeHtml(translateUiText(messages.loading))}</span>`;
  const toast = showActionToast(messages.loading, 'loading');

  try {
    const result = await action();
    showActionToast(messages.success, 'success', toast);
    return result;
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : messages.error;
    showActionToast(detail || messages.error, 'error', toast);
    throw caught;
  } finally {
    button.dataset.loading = 'false';
    button.disabled = wasDisabled;
    button.removeAttribute('aria-busy');
    button.classList.remove('button-loading');
    button.innerHTML = originalMarkup;
  }
}

function brandLogo(extraClass = ''): string {
  const className = `brand-logo${extraClass ? ` ${extraClass}` : ''}`;
  return `
    <span class="${className}" aria-hidden="true">
      <span class="brand-logo__plate"><span class="brand-logo__fork"></span><span class="brand-logo__knife"></span></span>
      <span class="brand-logo__receipt"><span></span><span></span><span></span></span>
    </span>
  `;
}

function renderLogin(message = loginNotice): void {
  const shell = el('main', 'login-shell');
  const welcome = el('section', 'login-welcome');
  welcome.innerHTML = `
    <div class="login-welcome__brand">${brandLogo('brand-logo--large')}<div><strong>${APP_NAME}</strong><span>Restaurant command center</span></div></div>
    <div class="login-welcome__content">
      <p class="eyebrow">Service, simplified</p>
      <h1>Run every shift<br />with confidence.</h1>
      <p>One secure workspace for your dining room, kitchen, billing, inventory, and team.</p>
      <ul class="login-benefits">
        <li><span aria-hidden="true">&#10003;</span> Live service and preparation status</li>
        <li><span aria-hidden="true">&#10003;</span> Permission-aware staff workspaces</li>
        <li><span aria-hidden="true">&#10003;</span> Reliable billing and operational insight</li>
      </ul>
    </div>
    <p class="login-welcome__footer"><span class="status-dot"></span> Secure restaurant operations, all in one place</p>
  `;
  const card = el('form', 'login-card');
  card.innerHTML = `
    <div class="login-card__heading">
      <p class="eyebrow">Staff access</p>
      <h2>Welcome back</h2>
      <p>Sign in with your staff credentials to start your shift.</p>
    </div>
    <label class="login-field"><span>Username or email</span><span class="login-input"><span class="login-input__icon" aria-hidden="true">@</span><input name="identifier" autocomplete="username" placeholder="Enter your username" autofocus required /></span></label>
    <label class="login-field"><span>Password</span><span class="login-input"><span class="login-input__icon login-input__icon--lock" aria-hidden="true"></span><input name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required /><button class="password-toggle" type="button" aria-label="Show password" aria-pressed="false">Show</button></span></label>
    <p class="form-error" role="alert" ${message ? '' : 'hidden'}>${message ?? ''}</p>
    <button class="login-submit" type="submit"><span>Sign in securely</span><span aria-hidden="true">&#8594;</span></button>
    <div class="login-security"><span aria-hidden="true">&#128274;</span><p><strong>Protected session</strong><br />Only a revocable session token is stored on this device.</p></div>
  `;
  const passwordInput = card.querySelector<HTMLInputElement>('input[name="password"]');
  const passwordToggle = card.querySelector<HTMLButtonElement>('.password-toggle');
  passwordToggle?.addEventListener('click', () => {
    if (!passwordInput || !passwordToggle) return;
    const isVisible = passwordInput.type === 'text';
    passwordInput.type = isVisible ? 'password' : 'text';
    passwordToggle.textContent = isVisible ? 'Show' : 'Hide';
    passwordToggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
    passwordToggle.setAttribute('aria-pressed', String(!isVisible));
  });
  card.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(card);
    const input = form.get('identifier');
    const password = form.get('password');
    const error = card.querySelector<HTMLParagraphElement>('.form-error');
    const submit = card.querySelector<HTMLButtonElement>('.login-submit');
    try {
      if (submit) {
        submit.disabled = true;
        submit.querySelector('span')!.textContent = 'Signing in…';
      }
      session = await login(String(input ?? ''), String(password ?? ''));
      loginNotice = undefined;
      navigate(landingRoute(session).path);
    } catch (caught) {
      if (error) {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : 'Unable to sign in.';
      }
    } finally {
      if (submit && document.body.contains(submit)) {
        submit.disabled = false;
        submit.querySelector('span')!.textContent = 'Sign in securely';
      }
    }
  });
  shell.append(welcome, card);
  root.replaceChildren(shell);
}

function updateNetworkBanner(banner: HTMLElement): void {
  banner.className = `network-banner ${apiStatus}`;
  banner.textContent = apiStatus === 'online'
    ? 'Online — POS API reachable.'
    : apiStatus === 'degraded'
      ? `Degraded — ${apiStatusMessage}`
      : `Offline — ${apiStatusMessage}`;
}

function startHealthChecks(): void {
  if (healthTimer !== undefined) return;
  healthTimer = window.setInterval(() => {
    if (!session || apiStatus === 'online') return;
    void apiClient.health();
  }, 5_000);
}

function shellRoutes(permissions: Action[]): AppRoute[] {
  return visibleRoutes(permissions);
}

function shellRouteMatches(item: AppRoute, currentHash: string, current: AppRoute): boolean {
  if (item.path === currentHash) return true;
  if (!item.path.includes('?')) {
    const currentStation = new URLSearchParams(currentHash.split('?')[1] ?? '').get('station');
    return item.path === current.path && !(item.path === '#/prep-stations' && currentStation);
  }
  const [itemPath, itemQuery = ''] = item.path.split('?');
  const [currentPath, currentQuery = ''] = currentHash.split('?');
  if (itemPath !== currentPath) return false;
  const itemStation = new URLSearchParams(itemQuery).get('station');
  const currentStation = new URLSearchParams(currentQuery).get('station');
  return Boolean(itemStation && itemStation === currentStation);
}

function renderShell(content: HTMLElement): void {
  if (!session) return renderLogin();

  const available = shellRoutes(session.permissions);
  const current = activeRoute();
  const currentHash = route || current.path;
  if (!canAccessRoute(current, session.permissions)) {
    navigate(landingRoute(session).path);
    return;
  }

  const roles = userRoles(session.user);
  const shellRole = roles[0]?.replace(/[^a-z0-9_-]/gi, '-') ?? 'staff';
  // Every authenticated workspace uses the same permission-aware navigation shell.
  // This keeps operational roles oriented in the same way as superadmins while
  // preserving a compact route switcher on small screens.
  const layout = el('div', `app-shell unified-navigation-shell role-${shellRole}${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`);
  const sidebar = el('aside', 'sidebar');
  const roleLabel = Array.isArray(session.user.role) ? session.user.role.join(', ') : session.user.role;
  sidebar.innerHTML = `
    <div class="sidebar-top"><div class="sidebar-brand">${brandLogo()}<div><h1>${APP_NAME}</h1><span>Restaurant command center</span></div></div><button type="button" class="sidebar-toggle" aria-label="${translateUiText(sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation')}" aria-expanded="${String(!sidebarCollapsed)}" title="${translateUiText(sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation')}"><span aria-hidden="true">${sidebarCollapsed ? '›' : '‹'}</span></button></div>
    <p class="sidebar-user">${session.user.id} · ${roleLabel}</p>
  `;
  sidebar.querySelector<HTMLButtonElement>('.sidebar-toggle')?.addEventListener('click', () => {
    sidebarCollapsed = !sidebarCollapsed;
    window.localStorage.setItem('sym-pos-sidebar-collapsed', String(sidebarCollapsed));
    renderShell(content);
  });

  const mobileNav = el('div', 'mobile-route-bar');
  mobileNav.innerHTML = `
    <div class="mobile-route-brand">${brandLogo()}<div><strong>${APP_NAME}</strong><span>${translateUiHtml(current.label)}</span></div></div>
  `;
  const routeSelect = el('select');
  routeSelect.setAttribute('aria-label', translateUiText('Switch POS section'));
  for (const item of available) {
    const option = el('option', '', translateUiText(item.label));
    option.value = item.path;
    option.selected = shellRouteMatches(item, currentHash, current);
    routeSelect.append(option);
  }
  routeSelect.addEventListener('change', () => navigate(routeSelect.value));
  mobileNav.append(routeSelect);

  const tabletNav = el('nav', 'tablet-role-nav');
  tabletNav.setAttribute('aria-label', translateUiText('Role shortcuts'));
  for (const item of available.slice(0, 5)) {
    const link = el('a', shellRouteMatches(item, currentHash, current) ? 'active' : '', translateUiText(item.label));
    link.href = item.path;
    tabletNav.append(link);
  }

  for (const section of ['operations', 'admin'] as const) {
    const groupRoutes = available.filter((item) => item.section === section);
    if (!groupRoutes.length) continue;
    const heading = el('h2', '', translateUiText(section === 'operations' ? 'Operations' : 'Administration'));
    const nav = el('nav');
    for (const item of groupRoutes) {
      const link = el('a', shellRouteMatches(item, currentHash, current) ? 'active' : '', translateUiText(item.label));
      link.href = item.path;
      link.title = translateUiText(item.label);
      link.dataset.shortLabel = item.label.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
      nav.append(link);
    }
    sidebar.append(heading, nav);
  }

  const signOut = el('button', 'secondary', translateUiText('Sign out'));
  signOut.title = translateUiText('Sign out');
  signOut.addEventListener('click', () => {
    void logout().finally(() => {
      session = null;
      renderLogin();
    });
  });
  sidebar.append(signOut);

  const main = el('main', 'content');
  const banner = el('div', 'network-banner');
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  updateNetworkBanner(banner);
  main.append(mobileNav, tabletNav, banner, content);
  startHealthChecks();
  layout.append(sidebar, main);
  root.replaceChildren(layout);
}

function page(title: string, subtitle: string, actions: string[] = []): HTMLElement {
  const section = el('section', 'page');
  const header = el('header', 'page-header');
  header.innerHTML = `<p class="eyebrow">${APP_NAME} ${translateUiHtml('client')}</p><h2>${translateUiHtml(title)}</h2><p>${translateUiHtml(subtitle)}</p>`;
  const grid = el('div', 'card-grid');
  for (const action of actions) {
    const card = el('article', 'card');
    card.innerHTML = `<h3>${translateUiHtml(action)}</h3><p>${translateUiHtml('Ready for day-to-day restaurant operations from one secure workspace.')}</p>`;
    grid.append(card);
  }
  section.append(header, grid);
  return section;
}


type DashboardTone = 'service' | 'cashier' | 'prep' | 'admin' | 'inventory' | 'management';

interface DashboardMetric {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}

interface DashboardAction {
  label: string;
  description: string;
  path: string;
  permission?: Action;
}

interface DashboardProfile {
  title: string;
  subtitle: string;
  focus: string;
  tone: DashboardTone;
  actions: DashboardAction[];
}

function userRoles(user: AuthenticatedUser): string[] {
  return Array.isArray(user.role) ? user.role : [user.role];
}

function hasAnyPermission(permissions: Action[], actions: Action[]): boolean {
  return actions.some((action) => permissions.includes(action));
}

function firstAccessibleDashboardAction(actions: DashboardAction[], permissions: Action[]): DashboardAction | undefined {
  return actions.find((action) => !action.permission || permissions.includes(action.permission));
}

function dashboardProfileForCurrentUser(): DashboardProfile {
  const permissions = session?.permissions ?? [];
  const roles = session ? userRoles(session.user) : [];
  const isSuperadmin = roles.includes('superadmin') || permissions.includes(Actions.ManageSystem);
  const isManager = roles.some((roleName) => ['manager', 'admin', 'shift_lead'].includes(roleName));
  const isCashier = roles.includes('cashier') || permissions.includes(Actions.CloseBill);
  const isWaitstaff = roles.includes('waitstaff') || (permissions.includes(Actions.CreateOrder) && !isCashier && !isManager && !isSuperadmin);
  const isInventory = roles.includes('inventory_clerk') || (permissions.includes(Actions.AdjustStock) && !hasAnyPermission(permissions, [Actions.CreateOrder, Actions.CloseBill, Actions.TransitionOrderStatus]));
  const isPrepOnly = roles.some((roleName) => ['kitchen', 'bar'].includes(roleName)) || (permissions.includes(Actions.TransitionOrderStatus) && !hasAnyPermission(permissions, [Actions.CreateOrder, Actions.CloseBill, Actions.AdjustStock, Actions.ManageMenu]));

  if (isSuperadmin) {
    return {
      title: 'Superadmin dashboard',
      subtitle: 'System setup, staff controls, billing configuration, and all live operations are one click away.',
      focus: 'System control center',
      tone: 'admin',
      actions: [
        { label: 'Super admin panel', description: 'Manage staff, roles, account access, localization, bill details, printers, and prep stations.', path: '#/superadmin', permission: Actions.ManageSystem },
        { label: 'Reports', description: 'Review performance and finance summaries.', path: '#/reports', permission: Actions.ViewReports },
        { label: 'Live operations', description: 'Jump into the restaurant floor.', path: '#/tables', permission: Actions.CreateOrder },
      ],
    };
  }

  if (isManager) {
    return {
      title: 'Manager dashboard',
      subtitle: 'Balance floor activity, reporting, staff setup, menu control, and inventory follow-up.',
      focus: 'Operations oversight',
      tone: 'management',
      actions: [
        { label: 'Reports', description: 'Review sales, inventory usage, and financial summary.', path: '#/reports', permission: Actions.ViewReports },
        { label: 'Table floor', description: 'See active tables and service bottlenecks.', path: '#/tables', permission: Actions.CreateOrder },
        { label: 'Inventory alerts', description: 'Act on low-stock and critical stock cards.', path: '#/inventory-alerts', permission: Actions.AdjustStock },
        { label: 'Menu admin', description: 'Update availability, routing, and promotions.', path: '#/menu-admin', permission: Actions.ManageMenu },
      ],
    };
  }

  if (isCashier) {
    return {
      title: 'Cashier dashboard',
      subtitle: 'Prioritize open bills, payments, daily sales, and handoff status for the counter.',
      focus: 'Billing and reports',
      tone: 'cashier',
      actions: [
        { label: 'Billing desk', description: 'Create bills, split payments, print receipts, and close paid tables.', path: '#/billing', permission: Actions.ViewBill },
        { label: 'Sales history', description: 'Check today’s invoice and payment history.', path: '#/sales-history', permission: Actions.ViewSalesHistory },
        { label: 'Table floor', description: 'Find occupied tables waiting for checkout.', path: '#/tables', permission: Actions.CreateOrder },
        { label: 'Kitchen status', description: 'Confirm order readiness before checkout.', path: '#/waiter-progress', permission: Actions.TransitionOrderStatus },
      ],
    };
  }

  if (isWaitstaff) {
    return {
      title: 'Waiter dashboard',
      subtitle: 'Focus on tables, orders, and item readiness so guests move smoothly from seating to service.',
      focus: 'Tables and orders',
      tone: 'service',
      actions: [
        { label: 'Table floor', description: 'Open tables and view active guest sessions.', path: '#/tables', permission: Actions.CreateOrder },
        { label: 'Order entry', description: 'Add items and send tickets to prep stations.', path: '#/orders', permission: Actions.CreateOrder },
        { label: 'Waiter progress', description: 'Track kitchen and bar readiness by station.', path: '#/waiter-progress', permission: Actions.TransitionOrderStatus },
        { label: 'Billing preview', description: 'Review bills before handing off payment.', path: '#/billing', permission: Actions.ViewBill },
      ],
    };
  }

  if (isInventory) {
    return {
      title: 'Inventory dashboard',
      subtitle: 'Start with low-stock alerts and stock movements that keep service supplied.',
      focus: 'Stock health',
      tone: 'inventory',
      actions: [
        { label: 'Inventory alerts', description: 'Review critical and warning stock levels.', path: '#/inventory-alerts', permission: Actions.AdjustStock },
      ],
    };
  }

  if (isPrepOnly) {
    return {
      title: roles.includes('bar') ? 'Bar dashboard' : roles.includes('kitchen') ? 'Kitchen dashboard' : 'Prep dashboard',
      subtitle: 'Stay on active tickets, start preparation quickly, and mark items ready for service.',
      focus: 'Prep ticket flow',
      tone: 'prep',
      actions: [
        { label: 'Prep boards', description: 'Work the active prep queue and switch between configured stations.', path: '#/prep-stations', permission: Actions.TransitionOrderStatus },
      ],
    };
  }

  return {
    title: 'Dashboard',
    subtitle: 'Your role-specific workspace is ready. Use the shortcuts below to continue.',
    focus: 'Role workspace',
    tone: 'management',
    actions: visibleRoutes(permissions).filter((item) => item.path !== '#/dashboard').slice(0, 4).map((item) => ({ label: item.label, description: 'Open this permitted POS workspace.', path: item.path })),
  };
}

function dashboardMetricCard(metric: DashboardMetric): HTMLElement {
  const card = el('article', `card dashboard-metric ${metric.tone ?? ''}`.trim());
  card.innerHTML = `<span>${translateUiHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><p>${translateUiHtml(metric.detail)}</p>`;
  return card;
}

function dashboardActionCard(action: DashboardAction): HTMLElement {
  const card = el('article', 'card dashboard-action');
  card.innerHTML = `<h3>${translateUiHtml(action.label)}</h3><p>${translateUiHtml(action.description)}</p><button type="button">${translateUiHtml('Open')}</button>`;
  card.querySelector('button')?.addEventListener('click', () => navigate(action.path));
  return card;
}

async function renderDashboard(): Promise<HTMLElement> {
  const permissions = session?.permissions ?? [];
  const profile = dashboardProfileForCurrentUser();
  const accessibleActions = profile.actions.filter((action) => !action.permission || permissions.includes(action.permission));
  const primaryAction = firstAccessibleDashboardAction(accessibleActions, permissions);
  const section = page(profile.title, profile.subtitle);
  section.classList.add('dashboard-page', `dashboard-page--${profile.tone}`);

  const hero = el('section', 'dashboard-hero');
  hero.innerHTML = `
    <div>
      <p class="eyebrow">${translateUiHtml(profile.focus)}</p>
      <h3>${translateUiHtml(`Welcome, ${session?.user.username ?? session?.user.id ?? 'team member'}`)}</h3>
      <p>${translateUiHtml('This landing page adapts to your role and highlights the work that matters first.')}</p>
    </div>
  `;
  if (primaryAction) {
    const button = el('button', '', translateUiText(primaryAction.label));
    button.type = 'button';
    button.addEventListener('click', () => navigate(primaryAction.path));
    hero.append(button);
  }

  const metrics: DashboardMetric[] = [];
  const metricLoaders: Promise<void>[] = [];

  if (permissions.includes(Actions.CreateOrder) || permissions.includes(Actions.ViewBill) || permissions.includes(Actions.CloseBill)) {
    metricLoaders.push(apiClient.listTableFloor(session?.user.branchId).then((floor) => {
      const occupied = floor.filter((row) => row.status === 'occupied').length;
      const available = floor.filter((row) => row.status === 'available').length;
      metrics.push({ label: 'Tables in service', value: String(occupied), detail: `${available} available · ${floor.length} total`, tone: occupied ? 'warning' : 'ready' });
    }).catch(() => { metrics.push({ label: 'Tables in service', value: '—', detail: 'Table floor unavailable right now.', tone: 'warning' }); }));
  }

  if (permissions.includes(Actions.CreateOrder) || permissions.includes(Actions.TransitionOrderStatus)) {
    metricLoaders.push(apiClient.getKdsSnapshot(undefined, 'active').then((snapshot) => {
      const activeItems = snapshot.groups.reduce((sum, group) => sum + group.items.length, 0);
      const preparing = snapshot.groups.flatMap((group) => group.items).filter((item) => item.progress === 'preparing').length;
      metrics.push({ label: 'Active prep items', value: String(activeItems), detail: `${preparing} preparing across ${snapshot.groups.length} stations`, tone: activeItems ? 'queued' : 'ready' });
    }).catch(() => { metrics.push({ label: 'Active prep items', value: '—', detail: 'Prep queue unavailable right now.', tone: 'warning' }); }));
  }

  if (permissions.includes(Actions.ViewSalesHistory) || permissions.includes(Actions.ViewReports)) {
    metricLoaders.push(loadCurrentBusinessDayRange().then((range) => apiClient.getSalesReport('day', range)).then((sales) => {
      metrics.push({ label: 'Today’s sales', value: money(sales.summary.revenue), detail: `${sales.summary.orderCount} orders · ${sales.summary.invoiceCount} invoices`, tone: 'ready' });
    }).catch(() => { metrics.push({ label: 'Today’s sales', value: '—', detail: 'Sales summary unavailable right now.', tone: 'warning' }); }));
  }

  if (permissions.includes(Actions.AdjustStock)) {
    metricLoaders.push(apiClient.getInventoryAlerts().then((alerts) => {
      const critical = alerts.filter((alert) => alert.severity === 'critical').length;
      metrics.push({ label: 'Stock alerts', value: String(alerts.length), detail: `${critical} critical items need attention`, tone: critical ? 'critical' : alerts.length ? 'warning' : 'ready' });
    }).catch(() => { metrics.push({ label: 'Stock alerts', value: '—', detail: 'Inventory alerts unavailable right now.', tone: 'warning' }); }));
  }

  await Promise.all(metricLoaders);
  if (!metrics.length) metrics.push({ label: 'Available sections', value: String(visibleRoutes(permissions).length), detail: 'Navigation is filtered by your permissions.', tone: 'ready' });

  const metricGrid = el('div', 'dashboard-metrics');
  for (const metric of metrics) metricGrid.append(dashboardMetricCard(metric));

  const actionGrid = el('div', 'dashboard-actions');
  if (!accessibleActions.length) actionGrid.append(emptyState('No additional workspaces are assigned to this role yet.'));
  for (const action of accessibleActions) actionGrid.append(dashboardActionCard(action));

  section.append(hero, metricGrid, el('h3', 'dashboard-section-title', translateUiText('Quick actions')), actionGrid);
  return section;
}


const assignableRoles = Object.keys(RolePermissions);

function roleOptions(selectedRole?: string): string {
  return assignableRoles.map((role) => `<option value="${role}" ${role === selectedRole ? 'selected' : ''}>${role}</option>`).join('');
}


function normalizePrinterSettings(label: string, printer?: Partial<SuperadminPrinterSettings>): SuperadminPrinterSettings {
  return {
    enabled: printer?.enabled !== false,
    displayName: printer?.displayName?.trim() || `${label} printer`,
    printerId: printer?.printerId?.trim() || 'Not configured',
    connectionType: printer?.connectionType === 'network' || printer?.connectionType === 'windows' ? printer.connectionType : 'simulator',
    windowsPrinterName: printer?.windowsPrinterName?.trim() || '',
    networkAddress: printer?.networkAddress?.trim() || '',
    networkPort: Number(printer?.networkPort) || 9100,
    copies: Number(printer?.copies) || 1,
    autoPrint: printer?.autoPrint ?? label !== 'Receipt',
  };
}


function settingsLocalizationMap(input: unknown): Record<string, string> {
  if (!input || Array.isArray(input) || typeof input !== 'object') return {};
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([english, myanmar]) => [english, String(myanmar ?? '')]));
}

function translationInputName(index: number): string {
  return `translation_${index}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function collectEnglishMyanmarTranslations(form: HTMLFormElement, entries: EnglishMyanmarTranslationEntry[]): Record<string, string> {
  const data = new FormData(form);
  return Object.fromEntries(entries.map((entry, index) => [entry.english, String(data.get(translationInputName(index)) ?? entry.myanmar).trim() || entry.myanmar]));
}

function normalizeStationId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function fallbackStationName(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizePrepStations(value: unknown): SuperadminPrepStation[] {
  const rows = Array.isArray(value) ? value : [];
  const stations = rows.map((row, index) => {
    const input = row as Partial<SuperadminPrepStation> & { name?: string };
    const id = normalizeStationId(String(input.id ?? input.name ?? input.displayName ?? ''));
    if (!id || id === 'receipt') return undefined;
    return {
      id,
      displayName: String(input.displayName ?? input.name ?? fallbackStationName(id)).trim() || fallbackStationName(id),
      enabled: input.enabled !== false,
      sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : (index + 1) * 10,
    };
  }).filter((station): station is SuperadminPrepStation => Boolean(station));
  return stations.length ? stations.sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName)) : [
    { id: 'kitchen', displayName: 'Kitchen', enabled: true, sortOrder: 10 },
    { id: 'bar', displayName: 'Bar', enabled: true, sortOrder: 20 },
  ];
}

function normalizeOperationalSettings(response: unknown): SuperadminOperationalSettings {
  const runtimeSettings = (response ?? {}) as RuntimeSettingsResponse;
  const posSettings = runtimeSettings.pos ?? runtimeSettings;
  const billInfo = posSettings.restaurantBillInfo ?? runtimeSettings.restaurantBillInfo ?? {};
  const branch = runtimeSettings.branch ?? {};
  const localization = posSettings.localization ?? runtimeSettings.localization ?? {};
  const prepStations = normalizePrepStations((posSettings as any).prepStations);
  const rawPrinters = posSettings.printers ?? {};
  const printers = {} as SuperadminOperationalSettings['printers'];
  for (const [key, printer] of Object.entries(rawPrinters)) printers[key] = normalizePrinterSettings(fallbackStationName(key), printer);
  if (!printers.receipt) printers.receipt = normalizePrinterSettings('Receipt');
  for (const station of prepStations) if (!printers[station.id]) printers[station.id] = normalizePrinterSettings(station.displayName);
  const rawAssignments = (posSettings as any).printerAssignments ?? {};
  const printerAssignments: Record<string, string> = {};
  for (const operation of ['receipt', ...prepStations.map((station) => station.id)]) {
    const assigned = String(rawAssignments[operation] ?? operation);
    printerAssignments[operation] = printers[assigned] ? assigned : 'receipt';
  }

  cachedPrepStations = prepStations;

  return {
    menuInventoryLinkEnabled: (posSettings as any).menuInventoryLinkEnabled === true,
    restaurantBillInfo: {
      restaurantName: billInfo.restaurantName?.trim() || branch.branchName?.trim() || APP_NAME,
      address: billInfo.address?.trim() || branch.address?.trim() || 'Address not configured',
      contact: billInfo.contact?.trim() || branch.contactNumber?.trim() || 'Contact not configured',
      taxId: billInfo.taxId?.trim() || undefined,
      receiptFooter: billInfo.receiptFooter?.trim() || undefined,
    },
    tax: {
      enabled: typeof (posSettings as any).tax?.enabled === 'boolean' ? (posSettings as any).tax.enabled : false,
      rate: Number.isFinite(Number((posSettings as any).tax?.rate)) ? Number((posSettings as any).tax.rate) : 0,
    },
    prepStations,
    printers,
    printerAssignments,
    localization: {
      defaultLocale: normalizeLocale(localization.defaultLocale),
      englishToMyanmar: { ...settingsLocalizationMap(localization.englishToMyanmar) },
    },
  };
}

function printerStatusCard(label: string, printer: SuperadminPrinterSettings, liveStatus?: PrinterStatus): string {
  const statusLabels: Record<PrinterStatus['status'], string> = { online: 'Online', offline: 'Offline', disabled: 'Disabled', simulator: 'Simulator', not_configured: 'Not configured' };
  const status = liveStatus ? statusLabels[liveStatus.status] : 'Status unavailable';
  const statusClass = liveStatus?.status === 'online' ? 'ready' : liveStatus?.status === 'offline' || liveStatus?.status === 'not_configured' ? 'critical' : 'warning';
  const connection = liveStatus?.connection ?? (printer.connectionType === 'network' ? `${printer.networkAddress || 'No address'}:${printer.networkPort}` : printer.connectionType === 'windows' ? printer.windowsPrinterName || 'No queue name' : 'Simulator');
  return `
    <div class="superadmin-printer-card">
      <span class="badge ${statusClass}">${status}</span>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(printer.displayName)}</span>
      <small>Device ID: ${escapeHtml(printer.printerId)}</small>
      <small>Connection: ${escapeHtml(connection)}</small>
      <small>${escapeHtml(liveStatus?.detail ?? 'The live printer check could not be loaded.')}</small>
    </div>
  `;
}

function systemMonitorCards(status?: SystemStatus, error?: string): string {
  if (!status) return `
    <div class="superadmin-monitor-card">
      <span class="badge critical">Unavailable</span>
      <strong>System monitor</strong>
      <small>${escapeHtml(error ?? 'The live system check could not be loaded.')}</small>
    </div>
  `;

  const databaseTone = status.database.status === 'operational' ? 'ready' : status.database.status === 'unavailable' ? 'critical' : 'warning';
  const databaseLabel = status.database.status === 'operational' ? 'Connected' : status.database.status === 'unavailable' ? 'Not working' : 'Not configured';
  const latency = status.database.latencyMs === undefined ? '' : ` · ${status.database.latencyMs} ms`;
  return `
    <div class="superadmin-monitor-card">
      <span class="badge ready">Working</span>
      <strong>POS API</strong>
      <span>Uptime: ${formatUptime(status.api.uptimeSeconds)}</span>
      <small>${escapeHtml(status.api.detail)}</small>
    </div>
    <div class="superadmin-monitor-card">
      <span class="badge ${databaseTone}">${databaseLabel}</span>
      <strong>Database</strong>
      <span>${escapeHtml(status.database.backend === 'postgres' ? 'PostgreSQL' : 'Memory only')}${latency}</span>
      <small>${escapeHtml(status.database.target)}</small>
      <small>${escapeHtml(status.database.detail)}</small>
    </div>
  `;
}

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}


function localeOptionsHtml(selectedLocale: SupportedLocale): string {
  return listLocaleOptions().map((option) => `
    <option value="${option.locale}" ${option.locale === selectedLocale ? 'selected' : ''}>${option.label}</option>
  `).join('');
}

function superadminLocalizationCard(defaultLocale: SupportedLocale, englishToMyanmar: Record<string, string>): string {
  const resource = getLocaleResource(defaultLocale);
  const switchState = buildLocaleSwitchState(defaultLocale);
  const unicode = verifyUnicodeCompatibility(defaultLocale);
  const entries = listEnglishMyanmarTranslationEntries(englishToMyanmar);
  return `
    <article class="card admin-card settings-card superadmin-localization-card">
      <div>
        <p class="eyebrow">Localization</p>
        <h3>Restaurant language & Myanmar labels</h3>
        <p class="muted">Choose the default UI, report, and receipt language for this branch, then edit the English → Myanmar label map used for Myanmar receipts and localized views.</p>
      </div>
      <form class="staff-form localization-form">
        <div class="localization-form__layout">
          <section class="localization-form__settings" aria-label="Language settings">
            <label>${switchState.label}
              <select name="defaultLocale">${localeOptionsHtml(defaultLocale)}</select>
            </label>
            <div class="locale-preview" style="font-family: ${resource.fontStack}; direction: ${resource.direction};">
              <strong>${resource.nativeName}</strong>
              <span>${resource.screens.billing} · ${resource.common.receipt} · ${resource.common.total_due}</span>
              <small>${unicode.sample}</small>
            </div>
            <p class="muted localization-form__fonts">Receipt font stack: ${unicode.recommendedFonts.join(', ')}</p>
          </section>
          <section class="localization-form__editor" aria-label="Myanmar label editor">
            <div class="translation-map">
              <div class="translation-map__header"><span>English label</span><span>Myanmar label</span></div>
              ${entries.map((entry, index) => `
                <label class="translation-row">
                  <span><small>${entry.namespace}.${entry.key}</small><strong>${escapeHtml(entry.english)}</strong></span>
                  <input name="${translationInputName(index)}" value="${escapeHtml(entry.myanmar)}" lang="my" />
                </label>
              `).join('')}
            </div>
          </section>
        </div>
        <div class="localization-form__actions">
          <p class="form-error" hidden></p>
          <button type="submit">Save localization</button>
        </div>
      </form>
    </article>
  `;
}

function attachLocalizationForm(container: ParentNode, settings: SuperadminOperationalSettings): void {
  container.querySelector<HTMLFormElement>('.localization-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const error = form.querySelector<HTMLParagraphElement>('.form-error');
    try {
      await apiClient.updateSettings({
        pos: {
          localization: {
            defaultLocale: normalizeLocale(String(data.get('defaultLocale') ?? settings.localization.defaultLocale)),
            englishToMyanmar: collectEnglishMyanmarTranslations(form, listEnglishMyanmarTranslationEntries(settings.localization.englishToMyanmar)),
          },
        },
      });
      render();
    } catch (caught) {
      if (error) {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : 'Unable to save language.';
      }
    }
  });
}

function rolesFor(user: AuthenticatedUser): string {
  return Array.isArray(user.role) ? user.role.join(',') : user.role;
}

function canCloseBills(): boolean {
  return !!session?.permissions.includes(Actions.CloseBill);
}

async function renderStaffSettings(isSuperadminPanel = false): Promise<HTMLElement> {
  const section = page(
    isSuperadminPanel ? 'Super admin workspace' : 'Staff & settings administration',
    isSuperadminPanel
      ? 'A polished control center for team access, restaurant identity, printers, menus, tables, reporting, and audit readiness.'
      : 'Create staff profiles, rotate passwords, assign roles, and deactivate access immediately.',
    isSuperadminPanel ? ['Team access', 'Restaurant profile', 'Device readiness', 'Quick controls'] : ['Staff users', 'Role assignment', 'Activation', 'Branch settings'],
  );
  if (isSuperadminPanel) section.classList.add('superadmin-page');

  const panel = el('section', isSuperadminPanel ? 'admin-panel superadmin-panel' : 'admin-panel');
  let systemStatus: SystemStatus | undefined;
  let systemStatusError: string | undefined;
  const [users, settingsResponse, printerStatuses] = await Promise.all([
    apiClient.listUsers(),
    apiClient.getSettings(),
    isSuperadminPanel ? apiClient.getPrinterStatuses().catch(() => ({} as Record<string, PrinterStatus>)) : Promise.resolve({} as Record<string, PrinterStatus>),
    isSuperadminPanel ? apiClient.getSystemStatus().then((value) => { systemStatus = value; }).catch((caught) => {
      systemStatusError = caught instanceof Error ? caught.message : 'The live system check failed.';
    }) : Promise.resolve(),
  ]);
  const settings = normalizeOperationalSettings(settingsResponse);
  const typography = getTypographyForLocale(settings.localization.defaultLocale);
  setActiveLocale(settings.localization.defaultLocale);
  root.style.fontFamily = typography.fontFamily;
  root.dir = typography.direction;
  const activeUsers = users.filter((user) => user.status === 'active').length;
  const inactiveUsers = users.length - activeUsers;
  const roleCount = new Set(users.flatMap((user) => Array.isArray(user.role) ? user.role : [user.role])).size;

  panel.innerHTML = `
    <article class="card admin-card staff-create-card">
      <div>
        <p class="eyebrow">People</p>
        <h3>${isSuperadminPanel ? 'Invite a staff member' : 'Create staff profile'}</h3>
        ${isSuperadminPanel ? '<p class="muted">Set the right role on day one so each teammate lands in the correct POS workflow.</p>' : ''}
      </div>
      <form class="staff-form">
        <label>User ID<input name="id" placeholder="server-01" /></label>
        <label>Username<input name="username" required /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Initial password<input name="password" type="password" minlength="8" required /></label>
        <label>Role<select name="role">${roleOptions('waitstaff')}</select></label>
        <label>Branch<input name="branchId" value="${session?.user.branchId ?? ''}" /></label>
        <button type="submit">Create profile</button>
        <p class="form-error" hidden></p>
      </form>
    </article>
    ${isSuperadminPanel ? `
      <article class="card admin-card superadmin-overview-card">
        <div>
          <p class="eyebrow">Today's control room</p>
          <h3>${settings.restaurantBillInfo.restaurantName}</h3>
          <p>${settings.restaurantBillInfo.address}</p>
          <p>${settings.restaurantBillInfo.contact}</p>
        </div>
        <div class="superadmin-metrics">
          <div><strong>${users.length}</strong><span>Total staff</span></div>
          <div><strong>${activeUsers}</strong><span>Active users</span></div>
          <div><strong>${inactiveUsers}</strong><span>Inactive users</span></div>
          <div><strong>${roleCount}</strong><span>Roles in use</span></div>
        </div>
        <div class="superadmin-monitor" aria-label="Live system monitor">
          ${systemMonitorCards(systemStatus, systemStatusError)}
        </div>
        <div class="superadmin-printers">
          ${printerStatusCard('Receipts', settings.printers[settings.printerAssignments.receipt], printerStatuses[settings.printerAssignments.receipt])}
          ${settings.prepStations.map((station) => printerStatusCard(station.displayName, settings.printers[settings.printerAssignments[station.id]], printerStatuses[settings.printerAssignments[station.id]])).join('')}
        </div>
      </article>
      <article class="card admin-card settings-card superadmin-station-card">
        <div>
          <p class="eyebrow">Prep routing</p>
          <h3>Add station, KDS board & printer</h3>
          <p class="muted">Stations are separate from menu categories. Add a station here, then route menu items to it from Menu admin.</p>
        </div>
        <form class="station-quick-add-form">
          <label>Station name<input name="stationName" required placeholder="Salad bar" /></label>
          <label>Printer ID<input name="printerId" placeholder="salad-bar-printer" /></label>
          <button type="submit">Add station</button>
          <p class="form-error" hidden></p>
        </form>
        <a class="secondary-link" href="#/bill-settings">Open full bill & printer settings</a>
      </article>
      <article class="card admin-card settings-card menu-inventory-link-card">
        <div>
          <p class="eyebrow">Inventory integration</p>
          <h3>Link menu sales to inventory</h3>
          <p class="muted">When off, menu items live independently: creating or selling them will not create, require, or deduct inventory records.</p>
        </div>
        <label class="checkbox-row settings-toggle">
          <input type="checkbox" class="menu-inventory-link-toggle" ${settings.menuInventoryLinkEnabled ? 'checked' : ''} />
          Enable menu–inventory linking
        </label>
        <p class="form-error menu-inventory-link-error" hidden></p>
      </article>
      ${superadminLocalizationCard(settings.localization.defaultLocale, settings.localization.englishToMyanmar)}
    ` : `
      <article class="card admin-card">
        <h3>Runtime settings</h3>
        <pre class="json-preview compact">${JSON.stringify(settingsResponse, null, 2)}</pre>
      </article>
    `}
  `;

  if (isSuperadminPanel) {
    const inventoryToggle = panel.querySelector<HTMLInputElement>('.menu-inventory-link-toggle');
    const inventoryError = panel.querySelector<HTMLElement>('.menu-inventory-link-error');
    inventoryToggle?.addEventListener('change', async () => {
      const nextValue = inventoryToggle.checked;
      inventoryToggle.disabled = true;
      if (inventoryError) inventoryError.hidden = true;
      try {
        await apiClient.updateSettings({ pos: { menuInventoryLinkEnabled: nextValue } });
      } catch (caught) {
        inventoryToggle.checked = !nextValue;
        if (inventoryError) {
          inventoryError.textContent = caught instanceof Error ? caught.message : 'Unable to save inventory integration setting.';
          inventoryError.hidden = false;
        }
      } finally {
        inventoryToggle.disabled = false;
      }
    });

    const launchpad = el('section', 'admin-launchpad superadmin-settings-launchpad');
    const settingsRoutes = superadminSettingsRoutes(session?.permissions ?? []);
    launchpad.innerHTML = `
      <div class="admin-launchpad-heading">
        <p class="eyebrow">Superadmin-only settings</p>
        <h3>Settings menu</h3>
        <p class="muted">System-only configuration lives here so the left navigation stays focused on primary workspaces.</p>
      </div>
      ${settingsRoutes.map((item) => `
        <button type="button" data-target="${escapeHtml(item.path)}">
          <span>${escapeHtml(item.label)}</span>
          <small>${item.path === '#/bill-settings' ? 'Receipt identity, prep stations, and printers' : 'Default language and English–Myanmar labels'}</small>
        </button>
      `).join('')}
    `;
    launchpad.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.target!)));
    panel.append(launchpad);
  }

  const staffListCard = el('article', 'card admin-card staff-list-card');
  staffListCard.innerHTML = `
    <div>
      <p class="eyebrow">Access roster</p>
      <h3>Staff directory</h3>
    </div>
  `;
  const staffTableWrap = el('div', 'staff-table-wrap');
  const table = el('table', 'staff-table');
  table.innerHTML = '<thead><tr><th>Staff</th><th>Role</th><th>Branch</th><th>Status</th><th>Update role/password</th><th>Access</th></tr></thead>';
  const body = el('tbody');
  for (const user of users) {
    const row = el('tr');
    row.innerHTML = `
      <td><strong>${user.username ?? user.id}</strong><br><small>${user.email ?? user.id}</small></td>
      <td>${rolesFor(user)}</td>
      <td>${user.branchId ?? '—'}</td>
      <td><span class="status-pill ${user.status}">${user.status}</span></td>
      <td>
        <form class="inline-staff-form" data-user-id="${user.id}">
          <select name="role">${roleOptions(rolesFor(user))}</select>
          <input name="password" type="password" minlength="8" placeholder="new password" />
          <button type="submit">Save</button>
        </form>
      </td>
      <td><button class="secondary toggle-staff" data-user-id="${user.id}" data-next-status="${user.status === 'active' ? 'inactive' : 'active'}">${user.status === 'active' ? 'Deactivate' : 'Activate'}</button></td>
    `;
    body.append(row);
  }
  table.append(body);
  staffTableWrap.append(table);
  staffListCard.append(staffTableWrap);
  panel.append(staffListCard);

  if (isSuperadminPanel) {
    const tabDefinitions = [
      { id: 'overview', label: 'Overview', description: 'Health at a glance' },
      { id: 'team', label: 'Team & access', description: `${users.length} staff profiles` },
      { id: 'operations', label: 'Operations setup', description: `${settings.prepStations.length} prep stations` },
      { id: 'localization', label: 'Localization', description: getLocaleResource(settings.localization.defaultLocale).nativeName },
      { id: 'settings', label: 'System settings', description: 'Bills, printers & language' },
    ] as const;
    const params = new URLSearchParams(route.split('?')[1] ?? '');
    const requestedTab = params.get('tab');
    const initialTab = tabDefinitions.some((tab) => tab.id === requestedTab) ? requestedTab! : 'overview';
    const tabList = el('nav', 'workspace-tabs superadmin-tabs');
    tabList.setAttribute('aria-label', translateUiText('Super admin workspace sections'));
    tabList.setAttribute('role', 'tablist');
    tabList.innerHTML = tabDefinitions.map((tab) => `
      <button type="button" role="tab" data-admin-tab="${tab.id}">
        <span>${translateUiHtml(tab.label)}</span>
        <small>${translateUiHtml(tab.description)}</small>
      </button>
    `).join('');

    const panelAssignments: Array<[string, string]> = [
      ['.superadmin-overview-card', 'overview'],
      ['.staff-create-card', 'team'],
      ['.staff-list-card', 'team'],
      ['.superadmin-station-card', 'operations'],
      ['.menu-inventory-link-card', 'settings'],
      ['.superadmin-localization-card', 'localization'],
      ['.superadmin-settings-launchpad', 'settings'],
    ];
    for (const [selector, tabId] of panelAssignments) {
      const item = panel.querySelector<HTMLElement>(selector);
      if (item) {
        item.dataset.adminPanel = tabId;
        item.setAttribute('role', 'tabpanel');
      }
    }

    const activateTab = (tabId: string, updateUrl = true): void => {
      tabList.querySelectorAll<HTMLButtonElement>('[data-admin-tab]').forEach((button) => {
        const active = button.dataset.adminTab === tabId;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      panel.querySelectorAll<HTMLElement>('[data-admin-panel]').forEach((item) => {
        item.hidden = item.dataset.adminPanel !== tabId;
      });
      panel.dataset.activeTab = tabId;
      if (updateUrl) {
        const next = new URLSearchParams(route.split('?')[1] ?? '');
        next.set('tab', tabId);
        const nextHash = `${routePath()}?${next.toString()}`;
        window.history.replaceState(null, '', nextHash);
        route = nextHash;
      }
    };

    tabList.querySelectorAll<HTMLButtonElement>('[data-admin-tab]').forEach((button, index, buttons) => {
      button.addEventListener('click', () => activateTab(button.dataset.adminTab!));
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextButton = buttons[(index + direction + buttons.length) % buttons.length];
        nextButton.focus();
        activateTab(nextButton.dataset.adminTab!);
      });
    });
    activateTab(initialTab, false);
    section.append(tabList, panel);
  } else {
    section.append(panel);
  }

  attachLocalizationForm(panel, settings);

  panel.querySelector<HTMLFormElement>('.station-quick-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const stationName = String(data.get('stationName') ?? '').trim();
    const stationId = normalizeStationId(stationName);
    const error = form.querySelector<HTMLParagraphElement>('.form-error');
    if (!stationId) {
      if (error) {
        error.hidden = false;
        error.textContent = 'Station name is required.';
      }
      return;
    }
    const prepStations = settings.prepStations.filter((station) => station.id !== stationId);
    const printers: Record<string, SuperadminPrinterSettings> = { ...settings.printers };
    prepStations.push({ id: stationId, displayName: stationName, enabled: true, sortOrder: (prepStations.length + 1) * 10 });
    printers[stationId] = {
      enabled: true,
      printerId: String(data.get('printerId') ?? '').trim() || `${stationId}-printer`,
      displayName: `${stationName} printer`,
      connectionType: 'simulator', networkPort: 9100, copies: 1, autoPrint: true,
    };
    try {
      await apiClient.updateSettings({
        pos: {
          restaurantBillInfo: settings.restaurantBillInfo,
          prepStations,
          printers,
          localization: settings.localization,
        },
      });
      render();
    } catch (caught) {
      if (error) {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : 'Unable to add station.';
      }
    }
  });

  panel.querySelector<HTMLFormElement>('.staff-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const error = form.querySelector<HTMLParagraphElement>('.form-error');
    try {
      await apiClient.createUser({
        id: String(data.get('id') ?? '').trim() || undefined,
        username: String(data.get('username') ?? ''),
        email: String(data.get('email') ?? '').trim() || undefined,
        password: String(data.get('password') ?? ''),
        role: String(data.get('role') ?? 'waitstaff'),
        branchId: String(data.get('branchId') ?? '').trim() || undefined,
      });
      render();
    } catch (caught) {
      if (error) {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : 'Unable to create user.';
      }
    }
  });

  panel.querySelectorAll<HTMLFormElement>('.inline-staff-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    await apiClient.updateUser(form.dataset.userId!, { role: String(data.get('role') ?? 'waitstaff'), password: password || undefined });
    render();
  }));

  panel.querySelectorAll<HTMLButtonElement>('.toggle-staff').forEach((button) => button.addEventListener('click', async () => {
    if (button.dataset.nextStatus === 'active') await apiClient.activateUser(button.dataset.userId!);
    else await apiClient.deactivateUser(button.dataset.userId!);
    render();
  }));

  return section;
}


function emptyState(text: string): HTMLElement {
  return el('p', 'empty-state', text);
}

function badge(value: string, tone = ''): HTMLElement {
  return el('span', `badge ${tone}`.trim(), value.replace(/_/g, ' '));
}


function kdsDestinationLabel(item: { serviceMode?: string; tableName?: string; tableId?: string; tableSessionId?: string; takeoutName?: string }): string {
  if (item.serviceMode === 'takeout') return item.takeoutName?.trim() ? `Takeout: ${item.takeoutName.trim()}` : 'Takeout: Guest';
  return `Table: ${item.tableName ?? item.tableId ?? item.tableSessionId ?? 'Unassigned table'}`;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

async function renderKdsStation(station: string, stationLabel?: string): Promise<HTMLElement> {
  const title = `${stationLabel ?? fallbackStationName(station)} KDS`;
  const section = page(title, `${title} tickets are grouped by active prep tickets and ready history.`);
  const activeTab = new URLSearchParams(route.split('?')[1] ?? '').get('tab') === 'history' ? 'history' : 'active';
  const queue = await apiClient.getKdsSnapshot(station, activeTab);
  const group = queue.groups.find((row) => row.station === station);
  const board = el('div', 'kds-board');
  const items = group?.items ?? [];
  const tabs = el('div', 'sales-history-tabs kds-tabs');
  tabs.innerHTML = `
    <button type="button" class="${activeTab === 'active' ? 'active' : ''}" data-tab="active">Active orders</button>
    <button type="button" class="${activeTab === 'history' ? 'active' : ''}" data-tab="history">History</button>
  `;
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => {
    const separator = routePath() === '#/prep-stations' ? `?station=${encodeURIComponent(station)}&` : '?';
    navigate(`${routePath()}${separator}tab=${button.dataset.tab}`);
  }));

  if (!items.length) board.append(emptyState(activeTab === 'history' ? `No ${stationLabel ?? station} tickets are ready yet.` : `No active ${stationLabel ?? station} tickets are waiting.`));
  for (const item of items) {
    const ticket = el('article', `kds-ticket ${item.progress}`);
    ticket.innerHTML = `
      <div class="ticket-head"><strong>${item.quantity}× ${escapeHtml(item.itemName)}</strong><span>${formatElapsed(item.elapsedSeconds)}</span></div>
      <p>Order ${item.orderId.slice(-8)} · ${escapeHtml(kdsDestinationLabel(item))}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</p>
      <div class="ticket-actions"></div>
    `;
    ticket.querySelector('.ticket-head')?.append(badge(item.progress, item.progress));
    const actions = ticket.querySelector<HTMLElement>('.ticket-actions')!;
    if (activeTab === 'history') {
      actions.append(el('small', 'muted', 'Moved to history when marked ready.'));
    } else {
      for (const next of ['preparing', 'ready'] as const) {
        const button = el('button', next === item.progress ? 'secondary' : '', next === 'preparing' ? 'Start prep' : 'Mark ready');
        button.type = 'button';
        button.disabled = item.progress === next || item.progress === 'served';
        button.addEventListener('click', async () => {
          await apiClient.patchKdsItemProgress(session!.user.id, item.orderId, item.orderItemId, next);
          render();
        });
        actions.append(button);
      }
    }
    board.append(ticket);
  }
  section.append(tabs, board);
  return section;
}

async function renderPrepStations(): Promise<HTMLElement> {
  const settings = normalizeOperationalSettings(await apiClient.getSettings());
  const params = new URLSearchParams(route.split('?')[1] ?? '');
  const stationId = params.get('station');
  const station = settings.prepStations.find((row) => row.id === stationId) ?? settings.prepStations[0];
  if (!station) return page('Prep boards', 'No prep stations are configured yet. Add one from Bill & printer settings.');
  const section = await renderKdsStation(station.id, station.displayName);
  const switcher = el('div', 'sales-history-tabs kds-tabs');
  switcher.innerHTML = settings.prepStations.map((row) => `<button type="button" class="${row.id === station.id ? 'active' : ''}" data-station="${escapeHtml(row.id)}">${escapeHtml(row.displayName)}</button>`).join('');
  switcher.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => navigate(`#/prep-stations?station=${encodeURIComponent(button.dataset.station ?? '')}`)));
  section.prepend(switcher);
  return section;
}


async function renderWaiterProgress(): Promise<HTMLElement> {
  const state = await loadOrderProgressForWaiter();
  const section = page('Waiter progress', 'Track all prep stations from one service view.');
  const lanes = el('div', 'progress-lanes');
  for (const group of state.snapshot.groups) {
    const lane = el('section', 'progress-lane');
    lane.append(el('h3', '', fallbackStationName(group.station)));
    if (!group.items.length) lane.append(emptyState('No active items.'));
    for (const item of group.items) {
      const row = el('div', 'progress-row');
      row.innerHTML = `<strong>${escapeHtml(item.itemName)}</strong><span>${item.quantity}× · ${escapeHtml(item.progress)}</span><small>Order ${item.orderId.slice(-8)} · ${escapeHtml(kdsDestinationLabel(item))}</small>`;
      lane.append(row);
    }
    lanes.append(lane);
  }
  section.append(lanes);
  return section;
}

async function renderMenuAdmin(): Promise<HTMLElement> {
  const canEditMenuItems = Boolean(session?.permissions.includes(Actions.ManageSystem));
  const section = page('Menu admin', canEditMenuItems ? 'Create, edit, delete, route, and promote menu items.' : 'Create items, route them to configured prep stations, toggle availability, and flag promotions.');
  const state = await loadAdminMenuDashboard();
  const settings = normalizeOperationalSettings(await apiClient.getSettings());
  const stationOptions = (selected?: string) => settings.prepStations.map((station) => `<option value="${escapeHtml(station.id)}" ${station.id === selected ? 'selected' : ''}>${escapeHtml(station.displayName)}</option>`).join('');
  const panel = el('section', 'admin-panel menu-admin-panel');
  const categories = state.categories;
  panel.innerHTML = `
    <article class="card admin-card">
      <h3>Create category</h3>
      <form class="staff-form category-form">
        <label>Name<input name="name" required placeholder="Specials" /></label>
        <label>Sort order<input name="sortOrder" type="number" value="10" /></label>
        <button type="submit">Add category</button>
        <p class="form-error" hidden></p>
      </form>
    </article>
    <article class="card admin-card">
      <h3>Create menu item</h3>
      <form class="staff-form item-form">
        <label>Category<select name="categoryId">${categories.map((cat) => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</option>`).join('')}</select></label>
        <label>Name<input name="name" required placeholder="Tea leaf salad" /></label>
        <label>Price<input name="price" type="number" min="0" step="0.01" required /></label>
        <label>Station<select name="prepStation">${stationOptions()}</select></label>
        <label>Description<input name="description" /></label>
        <button type="submit">Add item</button>
        <p class="form-error" hidden></p>
      </form>
    </article>
  `;
  const list = el('div', 'menu-admin-list');
  if (!categories.length) list.append(emptyState('No categories yet. Create one to start building the menu.'));
  for (const category of categories) {
    const card = el('article', 'card menu-category-admin');
    card.append(el('h3', '', `${category.name} (${category.items.length})`));
    if (!category.items.length) card.append(emptyState('No menu items in this category.'));
    for (const item of category.items) {
      const row = el('div', 'menu-admin-row');
      let editForm: HTMLFormElement | undefined;
      row.innerHTML = `<div><strong>${escapeHtml(item.name)}</strong><small>${money(item.price)} · ${escapeHtml(item.prepStation ?? 'service')}${item.description ? ` · ${escapeHtml(item.description)}` : ''}</small></div>`;
      row.append(badge(item.isAvailable ? 'available' : 'hidden', item.isAvailable ? 'ready' : 'queued'));
      row.append(badge(item.isPromotional ? 'promo' : 'regular'));
      const actions = el('div', 'menu-admin-actions');
      const availability = el('button', 'secondary', item.isAvailable ? 'Hide' : 'Show');
      availability.type = 'button';
      availability.addEventListener('click', async () => { await apiClient.setMenuItemAvailability(item.id, !item.isAvailable); render(); });
      const promo = el('button', 'secondary', item.isPromotional ? 'Remove promo' : 'Make promo');
      promo.type = 'button';
      promo.addEventListener('click', async () => { await apiClient.setMenuItemPromotional(item.id, !item.isPromotional); render(); });
      actions.append(availability, promo);
      if (canEditMenuItems) {
        const edit = el('button', 'secondary', 'Edit');
        edit.type = 'button';
        const remove = el('button', 'secondary danger', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;
          await apiClient.deleteMenuItem(item.id);
          render();
        });
        actions.append(edit, remove);
        editForm = el('form', 'staff-form menu-item-edit-form');
        editForm.hidden = true;
        editForm.dataset.itemId = item.id;
        editForm.innerHTML = `
          <label>Category<select name="categoryId">${categories.map((cat) => `<option value="${escapeHtml(cat.id)}" ${cat.id === item.categoryId ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('')}</select></label>
          <label>Name<input name="name" required value="${escapeHtml(item.name)}" /></label>
          <label>Price<input name="price" type="number" min="0" step="0.01" required value="${item.price}" /></label>
          <label>Station<select name="prepStation">${stationOptions(item.prepStation)}</select></label>
          <label>Description<input name="description" value="${escapeHtml(item.description ?? '')}" /></label>
          <button type="submit">Save item</button>
          <button type="button" class="secondary cancel-edit">Cancel</button>
        `;
        const formForItem = editForm;
        edit.addEventListener('click', () => { formForItem.hidden = !formForItem.hidden; });
        formForItem.querySelector<HTMLButtonElement>('.cancel-edit')?.addEventListener('click', () => { formForItem.hidden = true; });
      }
      row.append(actions);
      card.append(row);
      if (editForm) card.append(editForm);
    }
    list.append(card);
  }
  panel.append(list);
  panel.querySelector<HTMLFormElement>('.category-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await apiClient.createMenuCategory({ name: String(data.get('name') ?? ''), sortOrder: Number(data.get('sortOrder') ?? 0) });
    render();
  });
  panel.querySelector<HTMLFormElement>('.item-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await apiClient.createMenuItem({
      categoryId: String(data.get('categoryId') ?? ''),
      name: String(data.get('name') ?? ''),
      description: String(data.get('description') ?? '') || undefined,
      price: Number(data.get('price') ?? 0),
      prepStation: String(data.get('prepStation') ?? 'kitchen'),
    });
    render();
  });
  panel.querySelectorAll<HTMLFormElement>('.menu-item-edit-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    await apiClient.updateMenuItem(form.dataset.itemId!, {
      categoryId: String(data.get('categoryId') ?? ''),
      name: String(data.get('name') ?? ''),
      description: String(data.get('description') ?? '') || undefined,
      price: Number(data.get('price') ?? 0),
      prepStation: String(data.get('prepStation') ?? 'kitchen'),
    });
    render();
  }));
  section.append(panel);
  return section;
}

async function renderInventoryAlerts(): Promise<HTMLElement> {
  const section = page('Inventory alerts', 'Monitor stock, create inventory masters, post adjustments, and choose deduction timing.');
  const [items, alerts, policy] = await Promise.all([apiClient.listInventoryItems(), apiClient.getInventoryAlerts(), apiClient.getInventoryDeductionPolicy()]);
  const panel = el('section', 'admin-panel inventory-panel');
  panel.innerHTML = `
    <article class="card admin-card"><h3>Deduction policy</h3><form class="inline-staff-form policy-form"><label>When to deduct stock<select name="policy"><option value="on_in_preparation" ${policy === 'on_in_preparation' ? 'selected' : ''}>When prep starts</option><option value="on_completed" ${policy === 'on_completed' ? 'selected' : ''}>When item completes</option><option value="manual" ${policy === 'manual' ? 'selected' : ''}>Manual only</option></select></label><button type="submit">Save policy</button></form></article>
    <article class="card admin-card"><h3>Create inventory item</h3><form class="staff-form inventory-item-form"><label>SKU<input name="sku" required /></label><label>Name<input name="name" required /></label><label>Unit<input name="unit" value="each" required /></label><label>Minimum<input name="minimumThreshold" type="number" step="0.001" value="5" /></label><label>Current stock<input name="currentStock" type="number" step="0.001" value="0" /></label><button type="submit">Create item</button></form></article>
  `;
  const alertGrid = el('div', 'card-grid');
  if (!alerts.length) alertGrid.append(el('article', 'card', 'No low-stock alerts.'));
  for (const alert of alerts) {
    const card = el('article', `card alert-card ${alert.severity}`);
    card.innerHTML = `<h3>${alert.itemName}</h3><p>${alert.currentBalance} ${alert.unit} remaining · minimum ${alert.minimumThreshold}</p>`;
    card.append(badge(alert.severity, alert.severity));
    alertGrid.append(card);
  }
  const table = el('table', 'staff-table inventory-table');
  table.innerHTML = '<thead><tr><th>Item</th><th>Balance</th><th>Threshold</th><th>Post movement</th></tr></thead>';
  const body = el('tbody');
  for (const item of items) {
    const row = el('tr');
    row.innerHTML = `<td><strong>${item.name}</strong><br><small>${item.sku}</small></td><td>${item.currentBalance} ${item.unit}</td><td>${item.minimumThreshold} ${item.unit}</td><td><form class="inline-staff-form movement-form" data-item-id="${item.id}"><select name="movementType"><option value="restock">Restock</option><option value="manual_adjustment">Manual adjustment</option><option value="wastage">Wastage</option></select><input name="quantityDelta" type="number" step="0.001" placeholder="Qty +/-" required /><input name="reason" placeholder="Reason" /><button type="submit">Post</button></form></td>`;
    body.append(row);
  }
  table.append(body);
  panel.append(alertGrid, table);
  panel.querySelector<HTMLFormElement>('.policy-form')?.addEventListener('submit', async (event) => { event.preventDefault(); await apiClient.setInventoryDeductionPolicy(String(new FormData(event.currentTarget as HTMLFormElement).get('policy')) as any); render(); });
  panel.querySelector<HTMLFormElement>('.inventory-item-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement);
    await apiClient.createInventoryItem({ sku: String(data.get('sku') ?? ''), name: String(data.get('name') ?? ''), unit: String(data.get('unit') ?? ''), minimumThreshold: Number(data.get('minimumThreshold') ?? 0), currentStock: Number(data.get('currentStock') ?? 0) }); render();
  });
  panel.querySelectorAll<HTMLFormElement>('.movement-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(form); const type = String(data.get('movementType') ?? 'restock') as any; let qty = Number(data.get('quantityDelta') ?? 0); if (type === 'wastage' && qty > 0) qty *= -1;
    await apiClient.addInventoryMovement({ itemId: form.dataset.itemId!, movementType: type, quantityDelta: qty, reason: String(data.get('reason') ?? '') || undefined }); render();
  }));
  section.append(panel);
  return section;
}


async function renderLocalizationSettings(): Promise<HTMLElement> {
  const section = page('Localization', 'Choose the default POS language and maintain Myanmar receipt labels.', ['Default language', 'Myanmar labels', 'Receipt fonts']);
  section.classList.add('superadmin-page');
  const settingsResponse = await apiClient.getSettings();
  const settings = normalizeOperationalSettings(settingsResponse);
  const typography = getTypographyForLocale(settings.localization.defaultLocale);
  setActiveLocale(settings.localization.defaultLocale);
  root.style.fontFamily = typography.fontFamily;
  root.dir = typography.direction;

  const panel = el('section', 'admin-panel localization-panel');
  panel.innerHTML = superadminLocalizationCard(settings.localization.defaultLocale, settings.localization.englishToMyanmar);
  section.append(panel);
  attachLocalizationForm(panel, settings);
  return section;
}

async function renderLocalCloudSyncSettings(): Promise<HTMLElement> {
  const [settings, diagnostics] = await Promise.all([apiClient.getCloudSyncSettings(), apiClient.getCloudSyncDiagnostics()]);
  const section = page('Cloud Synchronization', 'Operate and troubleshoot the local POS connection to the cloud service.', ['Manual synchronization', 'Safe diagnostics', 'Live health refresh']);
  section.classList.add('cloud-sync-page');
  const panel = el('section', 'admin-panel cloud-sync-panel');
  const source = (key: string) => settings.sources?.[key] === 'platform' ? 'Platform Settings' : settings.sources?.[key] === 'environment' ? 'Environment' : 'Built-in default';
  const timestamp = (value?: string) => value ? new Date(value).toLocaleString() : 'Never';
  panel.innerHTML = `
    <article class="card admin-card sync-health-card">
      <div class="sync-health-card__heading">
        <div><p class="eyebrow">Current synchronization health</p><h3>Cloud worker status</h3></div>
        <span class="sync-status-pill ${settings.enabled ? 'sync-status-pill--enabled' : ''}"><i aria-hidden="true"></i>${escapeHtml(settings.status)}</span>
      </div>
      <div class="settings-overview-card">
        <div class="settings-overview-card__item"><span>Last successful push</span><strong>${escapeHtml(timestamp(settings.lastSuccessfulPush))}</strong></div>
        <div class="settings-overview-card__item"><span>Last successful pull</span><strong>${escapeHtml(timestamp(settings.lastSuccessfulPull))}</strong></div>
        <div class="settings-overview-card__item"><span>Last heartbeat</span><strong>${escapeHtml(timestamp(settings.lastHeartbeat))}</strong></div>
        <div class="settings-overview-card__item"><span>Pending outbox</span><strong>${Number(settings.pendingOutboxEvents ?? 0)}</strong><small>events waiting to push</small></div>
        <div class="settings-overview-card__item"><span>Pending incoming</span><strong>${Number(settings.pendingIncomingEvents ?? 0)}</strong><small>events waiting to apply</small></div>
      </div>
      <div class="sync-phase-grid">${(['push', 'pull', 'heartbeat'] as const).map((phase) => { const health = settings.phases?.[phase] ?? { state: 'IDLE' }; return `<div><span>${phase === 'pull' ? 'Incoming pull' : phase[0].toUpperCase() + phase.slice(1)}</span><strong class="sync-phase--${String(health.state).toLowerCase()}">${escapeHtml(health.state)}</strong><small>Last success: ${escapeHtml(timestamp(health.lastSuccess))}</small></div>`; }).join('')}</div>
      <p class="sync-error-summary"><strong>Last sync error</strong><span>${escapeHtml(settings.lastError ?? 'None')}</span>${settings.diagnosticError ? '<button type="button" class="link-button error-details">Details</button>' : ''}</p>
      <div class="sync-actions"><button type="button" class="sync-now">Sync now</button><button type="button" class="secondary-button test-sync-top">Test connection</button><button type="button" class="secondary-button diagnostics-toggle">View diagnostics</button></div>
      <p class="form-error sync-run-result" aria-live="polite" hidden></p>
    </article>
    <article class="card admin-card sync-diagnostics" hidden>
      <div class="sync-health-card__heading"><div><p class="eyebrow">Troubleshooting</p><h3>Synchronization diagnostics</h3></div>${settings.diagnosticError ? '<button type="button" class="secondary-button clear-sync-error">Clear displayed error</button>' : ''}</div>
      <h4>Resolved Cloud Endpoints</h4><div class="sync-endpoints">${Object.values(diagnostics.endpoints ?? {}).map((endpoint: any) => `<div><strong>${escapeHtml(endpoint.label)}</strong><code>${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.url ?? 'Not configured')}</code></div>`).join('')}</div>
      <p><strong>Local application:</strong> ${escapeHtml(diagnostics.localApplicationVersion)} · <strong>Local protocol:</strong> ${escapeHtml(diagnostics.localProtocolVersion)}</p>
      <details><summary>Recent sync activity (${diagnostics.runtime?.activity?.length ?? 0})</summary><div class="sync-activity">${(diagnostics.runtime?.activity ?? []).map((item: any) => `<div><time>${escapeHtml(timestamp(item.timestamp))}</time><strong>${escapeHtml(item.operation)}</strong><span>${escapeHtml(item.outcome)}${item.httpStatus ? ` · HTTP ${Number(item.httpStatus)}` : ''}${item.eventCount !== undefined ? ` · ${Number(item.eventCount)} events` : ''}</span></div>`).join('') || '<p>No synchronization activity yet.</p>'}</div></details>
      <details><summary>Pending outgoing events (${diagnostics.queues?.outbox?.length ?? 0})</summary><div class="table-scroll"><table class="staff-table"><thead><tr><th>Event</th><th>Entity</th><th>Operation</th><th>Created</th><th>Attempts / retry</th><th>Last error</th></tr></thead><tbody>${(diagnostics.queues?.outbox ?? []).map((event: any) => `<tr><td><code>${escapeHtml(event.eventId)}</code></td><td>${escapeHtml(event.entityType)}<br><small>${escapeHtml(event.entityId)}</small></td><td>${escapeHtml(event.operation)}</td><td>${escapeHtml(timestamp(event.createdAt))}</td><td>${Number(event.attemptCount)}<br><small>${escapeHtml(timestamp(event.nextRetry))}</small></td><td>${escapeHtml(event.lastError || '—')}</td></tr>`).join('')}</tbody></table></div></details>
      <details><summary>Pending incoming events (${diagnostics.queues?.incoming?.length ?? 0})</summary><div class="sync-activity">${(diagnostics.queues?.incoming ?? []).map((event: any) => `<div><code>${escapeHtml(event.eventId)}</code><strong>${escapeHtml(event.entityType)}</strong><span>${escapeHtml(timestamp(event.createdAt))}</span></div>`).join('') || '<p>No pending incoming events.</p>'}</div></details>
    </article>
    <dialog class="sync-error-dialog"><form method="dialog"><button class="dialog-close" aria-label="Close">×</button><h3>Synchronization error</h3><div class="sync-error-detail"></div><button>Close</button></form></dialog>
    <article class="card admin-card settings-card settings-card--wide">
      <form class="cloud-sync-form staff-form">
        <div class="cloud-sync-form__intro">
          <div><p class="eyebrow">Synchronization settings</p><h3>Connect this POS to the cloud</h3><p>Changes are securely stored and picked up by the sync worker on its next cycle.</p></div>
          <label class="checkbox-row settings-toggle"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''} /><span><strong>Enable cloud sync</strong><small>Start push and pull cycles after saving.</small></span></label>
        </div>
        <fieldset class="cloud-sync-fieldset cloud-sync-fieldset--connection">
          <legend>Connection details</legend>
          <label class="cloud-sync-field--url">Cloud Sync URL<input type="url" name="cloudSyncBaseUrl" value="${escapeHtml(settings.cloudSyncBaseUrl ?? '')}" placeholder="https://cloud.example.com" /><small>Source: ${source('cloudSyncBaseUrl')}</small></label>
          <label>Store ID<input name="storeId" value="${escapeHtml(settings.storeId)}" required /><small>Source: ${source('storeId')}</small></label>
          <label>Device ID<input name="deviceId" value="${escapeHtml(settings.deviceId)}" required /><small>Source: ${source('deviceId')}</small></label>
          <label class="cloud-sync-field--token">Sync API Token<input type="password" name="token" autocomplete="new-password" placeholder="${settings.tokenConfigured ? '••••••••••••••••' : 'Enter token'}" /><small>${settings.tokenConfigured ? `Token configured · Source: ${source('token')}. Leave blank to keep it.` : 'No token configured.'}</small></label>
        </fieldset>
        <fieldset class="cloud-sync-fieldset cloud-sync-fieldset--schedule">
          <legend>Worker schedule &amp; limits</legend>
          <label>Push interval <span class="field-unit">seconds</span><input type="number" name="pushIntervalSeconds" min="5" value="${settings.pushIntervalMs / 1000}" required /></label>
          <label>Incoming poll <span class="field-unit">seconds</span><input type="number" name="pollIntervalSeconds" min="5" value="${settings.pollIntervalMs / 1000}" required /></label>
          <label>Request timeout <span class="field-unit">seconds</span><input type="number" name="requestTimeoutSeconds" min="1" value="${settings.requestTimeoutMs / 1000}" required /></label>
          <label>Batch size <span class="field-unit">events</span><input type="number" name="batchSize" min="1" max="1000" value="${settings.batchSize}" required /></label>
          <label>Event retention <span class="field-unit">days</span><input type="number" name="successRetentionDays" min="1" max="3650" value="${settings.successRetentionDays}" required /></label>
        </fieldset>
        <div class="settings-save-bar"><p class="form-error sync-result" aria-live="polite" hidden></p><button type="button" class="secondary-button test-sync">Test connection</button><button type="submit">Save settings</button></div>
      </form>
    </article>`;
  const form = panel.querySelector<HTMLFormElement>('.cloud-sync-form')!; const result = form.querySelector<HTMLElement>('.sync-result')!;
  const payload = () => { const data = new FormData(form); return { enabled: data.get('enabled') === 'on', cloudSyncBaseUrl: String(data.get('cloudSyncBaseUrl') ?? ''), storeId: String(data.get('storeId') ?? ''), deviceId: String(data.get('deviceId') ?? ''), token: String(data.get('token') ?? ''), pushIntervalMs: Number(data.get('pushIntervalSeconds')) * 1000, pollIntervalMs: Number(data.get('pollIntervalSeconds')) * 1000, requestTimeoutMs: Number(data.get('requestTimeoutSeconds')) * 1000, batchSize: Number(data.get('batchSize')), successRetentionDays: Number(data.get('successRetentionDays')) }; };
  const testConnection = async () => { result.hidden = false; result.textContent = 'Testing connection…'; try { const response = await apiClient.testCloudSyncConnection(payload()); result.textContent = `${response.message} · Cloud: ${response.cloud} · URL: ${response.resolvedTestUrl} · HTTP: ${response.httpStatus} · Authentication: ${response.authentication} · Store: ${response.store} · Device: ${response.device} · Protocol: ${response.protocolVersion} · Compatibility: ${response.compatible ? 'Compatible' : 'Incompatible'} · Latency: ${response.latencyMs} ms`; } catch (error) { result.textContent = error instanceof Error ? error.message : 'Connection test failed.'; } };
  form.querySelector<HTMLButtonElement>('.test-sync')?.addEventListener('click', testConnection);
  panel.querySelector<HTMLButtonElement>('.test-sync-top')?.addEventListener('click', testConnection);
  panel.querySelector<HTMLButtonElement>('.diagnostics-toggle')?.addEventListener('click', () => { const card = panel.querySelector<HTMLElement>('.sync-diagnostics')!; card.hidden = !card.hidden; });
  panel.querySelector<HTMLButtonElement>('.sync-now')?.addEventListener('click', async (event) => { const button = event.currentTarget as HTMLButtonElement; const output = panel.querySelector<HTMLElement>('.sync-run-result')!; button.disabled = true; button.textContent = 'Synchronizing…'; output.hidden = false; output.textContent = 'Running push, incoming pull, acknowledgement, and heartbeat…'; try { const response = await apiClient.runCloudSync(); output.textContent = `${response.status === 'completed' ? 'Synchronization completed' : 'Synchronization completed with errors'} · Pushed: ${response.push.accepted ?? 0}/${response.push.attempted ?? 0} · Incoming: ${response.pull.applied ?? 0}/${response.pull.received ?? 0} · Heartbeat: ${response.heartbeat.success ? 'successful' : 'failed'} · Duration: ${(response.durationMs / 1000).toFixed(1)} seconds`; window.setTimeout(() => { if (document.contains(section)) void render(); }, 500); } catch (error) { output.textContent = error instanceof Error ? error.message : 'Synchronization failed.'; button.disabled = false; button.textContent = 'Sync now'; } });
  panel.querySelector<HTMLButtonElement>('.clear-sync-error')?.addEventListener('click', async () => { await apiClient.clearCloudSyncError(); void render(); });
  panel.querySelector<HTMLButtonElement>('.error-details')?.addEventListener('click', () => { const error = settings.diagnosticError; const dialog = panel.querySelector<HTMLDialogElement>('.sync-error-dialog')!; const detail = dialog.querySelector<HTMLElement>('.sync-error-detail')!; detail.innerHTML = `<dl><dt>Operation</dt><dd>${escapeHtml(error.operation)}</dd><dt>Time</dt><dd>${escapeHtml(timestamp(error.occurredAt))}</dd><dt>Method</dt><dd>${escapeHtml(error.method ?? '—')}</dd><dt>Endpoint</dt><dd><code>${escapeHtml(error.endpoint ?? '—')}</code></dd><dt>Resolved URL</dt><dd><code>${escapeHtml(error.url ?? '—')}</code></dd><dt>HTTP status</dt><dd>${error.httpStatus ? Number(error.httpStatus) : 'Not available'}</dd><dt>Retryable</dt><dd>${error.retryable ? 'Yes' : 'No'}</dd><dt>Message</dt><dd>${escapeHtml(error.message)}</dd><dt>Cloud response</dt><dd>${escapeHtml(error.responseMessage || 'No safe response message')}</dd><dt>Suggested action</dt><dd>${escapeHtml(error.suggestedAction)}</dd></dl>`; dialog.showModal(); });
  form.addEventListener('submit', async (event) => { event.preventDefault(); result.hidden = false; result.textContent = 'Saving…'; try { await apiClient.updateCloudSyncSettings(payload()); result.textContent = 'Cloud synchronization settings saved. The worker will use them on its next cycle.'; } catch (error) { result.textContent = error instanceof Error ? error.message : 'Unable to save settings.'; } });
  section.append(panel);
  const refreshTimer = window.setInterval(() => { if (!document.contains(section)) { window.clearInterval(refreshTimer); return; } void apiClient.getCloudSyncSettings().then((fresh) => { const pill = panel.querySelector<HTMLElement>('.sync-status-pill'); if (pill) pill.lastChild!.textContent = fresh.status; }).catch(() => undefined); }, 8000);
  return section;
}

async function copyText(value: string, button: HTMLButtonElement): Promise<void> {
  await navigator.clipboard.writeText(value);
  const original = button.textContent;
  button.textContent = 'Copied';
  window.setTimeout(() => { button.textContent = original; }, 1500);
}

function renderCloudConnectionInformation(info: any): HTMLElement {
  const url = String(info.publicBaseUrl ?? 'Not configured');
  const defaults = info.recommendedLocalSettings;
  const configuration = `Local POS Cloud Sync Configuration\n\nCloud Sync URL:\n${url}\n\nStore ID:\n[restaurant/location assignment]\n\nDevice ID:\nregister-server-1\n\nPush Interval:\n${defaults.pushIntervalSeconds}\n\nPoll Interval:\n${defaults.pollIntervalSeconds}\n\nRequest Timeout:\n${defaults.requestTimeoutSeconds}\n\nBatch Size:\n${defaults.batchSize}`;
  const endpointRows = Object.entries(info.endpoints as Record<string, { method: string; path: string }>).map(([name, endpoint]) => `<tr><td>${escapeHtml(name.replace(/([A-Z])/g, ' $1'))}</td><td><code>${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.path)}</code></td></tr>`).join('');
  const section = page('Cloud Connection Information', 'Use these cloud deployment details to configure a restaurant POS. Secrets are never displayed.', ['Super Admin only', 'Public base URL', 'Read-only guidance']);
  const panel = el('section', 'admin-panel cloud-connection-panel');
  panel.innerHTML = `
    <article class="card admin-card sync-health-card">
      <p class="eyebrow">Cloud Sync Service</p><h3>${escapeHtml(info.status)}</h3>
      <div class="settings-overview-card">
        <div class="settings-overview-card__item"><span>Deployment Mode</span><strong>${escapeHtml(info.deploymentMode)}</strong></div>
        <div class="settings-overview-card__item"><span>Sync API</span><strong>${info.syncApiAvailable ? 'Available' : 'Unavailable'}</strong></div>
        <div class="settings-overview-card__item"><span>Sync Token</span><strong>${info.tokenConfigured ? 'Configured' : 'Not configured'}</strong></div>
        <div class="settings-overview-card__item"><span>Database</span><strong>${info.databaseAvailable ? 'Available' : 'Unavailable'}</strong></div>
      </div>
    </article>
    <article class="card admin-card settings-card settings-card--wide">
      <p class="eyebrow">Cloud Sync URL</p><h3><code class="cloud-base-url">${escapeHtml(url)}</code></h3>
      <p class="muted">Copy only this base URL. The local POS constructs the endpoint paths itself.</p>
      <button type="button" class="copy-cloud-url" ${info.publicBaseUrl ? '' : 'disabled'}>Copy URL</button>
      <h3>Recommended Local Configuration</h3>
      <div class="settings-overview-card">
        <div class="settings-overview-card__item"><span>Store ID</span><strong>Restaurant-specific</strong><small>${escapeHtml(info.storeId.guidance)}</small></div>
        <div class="settings-overview-card__item"><span>Device ID</span><strong>${escapeHtml(info.deviceId.example)}</strong><small>${escapeHtml(info.deviceId.guidance)}</small></div>
        <div class="settings-overview-card__item"><span>Push Interval</span><strong>${defaults.pushIntervalSeconds} seconds</strong></div>
        <div class="settings-overview-card__item"><span>Incoming Poll</span><strong>${defaults.pollIntervalSeconds} seconds</strong></div>
        <div class="settings-overview-card__item"><span>Request Timeout</span><strong>${defaults.requestTimeoutSeconds} seconds</strong></div>
        <div class="settings-overview-card__item"><span>Batch Size</span><strong>${defaults.batchSize}</strong></div>
      </div>
      <h3>Local POS Cloud Sync Configuration</h3><pre class="connection-package">${escapeHtml(configuration)}</pre>
      <button type="button" class="copy-configuration">Copy Configuration</button>
      <h3>API endpoints</h3><table class="staff-table"><thead><tr><th>Purpose</th><th>Existing route</th></tr></thead><tbody>${endpointRows}</tbody></table>
      <h3>Restaurant POS setup</h3><p><strong>Super Admin → Platform Settings → Cloud Synchronization</strong></p>
      <ol><li>Paste the Cloud Sync URL above.</li><li>Enter the restaurant's assigned Store ID.</li><li>Choose a unique Device ID, such as <code>register-server-1</code>.</li><li>Enter the matching Sync API Token supplied securely by the cloud administrator.</li><li>Test the connection, then enable synchronization.</li></ol>
    </article>`;
  panel.querySelector<HTMLButtonElement>('.copy-cloud-url')?.addEventListener('click', (event) => { void copyText(String(info.publicBaseUrl), event.currentTarget as HTMLButtonElement); });
  panel.querySelector<HTMLButtonElement>('.copy-configuration')?.addEventListener('click', (event) => { void copyText(configuration, event.currentTarget as HTMLButtonElement); });
  section.append(panel); return section;
}

async function renderCloudSyncSettings(): Promise<HTMLElement> {
  try { return renderCloudConnectionInformation(await apiClient.getCloudConnectionInformation()); }
  catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return renderLocalCloudSyncSettings();
    throw error;
  }
}

async function renderBillSettings(): Promise<HTMLElement> {
  const section = page('Bill, prep station & printer settings', 'Configure receipt details and add any prep board such as salad bar, helper counter, kitchen, or bar.', ['Receipt header', 'Prep stations', 'Station printers']);
  const settings = normalizeOperationalSettings(await apiClient.getSettings());
  const info = settings.restaurantBillInfo;
  const enabledStations = settings.prepStations.filter((station) => station.enabled).length;
  const enabledStationPrinters = settings.prepStations.filter((station) => settings.printers[settings.printerAssignments[station.id]]?.enabled).length;
  const panel = el('section', 'admin-panel bill-settings-panel');
  const form = el('form', 'bill-settings-form');
  const stationRows = settings.prepStations.map((station, index) => {
    const assignedPrinter = settings.printerAssignments[station.id];
    const printerOptions = Object.entries(settings.printers).map(([key, printer]) => `<option value="${escapeHtml(key)}" ${key === assignedPrinter ? 'selected' : ''}>${escapeHtml(printer.displayName)}</option>`).join('');
    return `
      <article class="station-settings-card" data-station-id="${escapeHtml(station.id)}">
        <div class="station-settings-card__order" aria-label="Station number">${index + 1}</div>
        <div class="station-settings-card__main">
          <div class="station-settings-card__heading">
            <div>
              <h4>${escapeHtml(station.displayName)}</h4>
              <small>${escapeHtml(station.id)}</small>
            </div>
            <a class="secondary-link" href="#/prep-stations?station=${encodeURIComponent(station.id)}">Open board</a>
          </div>
          <div class="settings-field-grid settings-field-grid--station">
            <label>Station ID<input name="stationId" value="${escapeHtml(station.id)}" readonly /></label>
            <label>Display name<input name="stationDisplayName" value="${escapeHtml(station.displayName)}" required /></label>
            <label>Sort order<input name="stationSortOrder" type="number" value="${station.sortOrder}" /></label>
            <label>Send tickets to<select name="stationPrinterAssignment">${printerOptions}</select></label>
          </div>
        </div>
        <div class="station-settings-card__toggles">
          <label class="checkbox-row"><input type="checkbox" name="stationEnabled" ${station.enabled ? 'checked' : ''} /> Board enabled</label>
        </div>
      </article>
    `;
  }).join('');
  const printerRows = Object.entries(settings.printers).map(([key, printer]) => `
    <article class="station-settings-card printer-device-card" data-printer-key="${escapeHtml(key)}">
      <div class="station-settings-card__main">
        <div class="station-settings-card__heading"><div><h4>${escapeHtml(printer.displayName)}</h4><small>Device ${escapeHtml(key)}</small></div></div>
        <div class="settings-field-grid settings-field-grid--station">
          <label>Device key<input name="printerKey" value="${escapeHtml(key)}" readonly /></label>
          <label>Printer ID<input name="printerId" value="${escapeHtml(printer.printerId)}" required /></label>
          <label>Display name<input name="printerDisplayName" value="${escapeHtml(printer.displayName)}" required /></label>
          <label>Connection<select name="printerConnection"><option value="simulator" ${printer.connectionType === 'simulator' ? 'selected' : ''}>Simulator / test</option><option value="windows" ${printer.connectionType === 'windows' ? 'selected' : ''}>Windows installed printer (USB)</option><option value="network" ${printer.connectionType === 'network' ? 'selected' : ''}>Wireless / LAN (TCP)</option></select></label>
          <label>Windows printer name<input name="windowsPrinterName" value="${escapeHtml(printer.windowsPrinterName ?? '')}" placeholder="Exact name from Windows Settings" /></label>
          <label>IP address / hostname<input name="printerAddress" value="${escapeHtml(printer.networkAddress ?? '')}" placeholder="192.168.1.50" /></label>
          <label>Port<input name="printerPort" type="number" min="1" max="65535" value="${printer.networkPort}" /></label>
          <label>Copies<input name="printerCopies" type="number" min="1" max="10" value="${printer.copies}" /></label>
        </div>
      </div>
      <div class="station-settings-card__toggles"><label class="checkbox-row"><input type="checkbox" name="printerEnabled" ${printer.enabled ? 'checked' : ''} /> Enabled</label><label class="checkbox-row"><input type="checkbox" name="printerAutoPrint" ${printer.autoPrint ? 'checked' : ''} /> Automatic jobs</label></div>
    </article>`).join('');
  const receiptPrinterOptions = Object.entries(settings.printers).map(([key, printer]) => `<option value="${escapeHtml(key)}" ${key === settings.printerAssignments.receipt ? 'selected' : ''}>${escapeHtml(printer.displayName)}</option>`).join('');
  form.innerHTML = `
    <section class="settings-overview-card" aria-label="Settings overview">
      <article class="settings-overview-card__item">
        <span>Receipt profile</span>
        <strong>${escapeHtml(info.restaurantName)}</strong>
        <small>${escapeHtml(info.contact)}</small>
      </article>
      <article class="settings-overview-card__item">
        <span>Prep boards</span>
        <strong>${enabledStations}/${settings.prepStations.length}</strong>
        <small>enabled stations</small>
      </article>
      <article class="settings-overview-card__item">
        <span>Station printers</span>
        <strong>${enabledStationPrinters}/${settings.prepStations.length}</strong>
        <small>enabled printer routes</small>
      </article>
      <article class="settings-overview-card__item">
        <span>Receipt printer</span>
        <strong>${Object.keys(settings.printers).length}</strong>
        <small>configured devices</small>
      </article>
    </section>

    <div class="settings-section-heading">
      <div>
        <p class="eyebrow">Step 1</p>
        <h3>Receipt identity</h3>
      </div>
      <p>These details appear on every customer bill and receipt.</p>
    </div>
    <section class="settings-card settings-card--wide">
      <div class="settings-field-grid settings-field-grid--bill">
        <label>Restaurant name<input name="restaurantName" value="${escapeHtml(info.restaurantName)}" required /></label>
        <label>Contact<input name="contact" value="${escapeHtml(info.contact)}" required /></label>
        <label>Tax / registration ID<input name="taxId" value="${escapeHtml(info.taxId ?? '')}" /></label>
        <label class="settings-field-grid__wide">Address<textarea name="address" rows="3" required>${escapeHtml(info.address)}</textarea></label>
        <label class="settings-field-grid__wide">Receipt footer<input name="receiptFooter" value="${escapeHtml(info.receiptFooter ?? '')}" /></label>
      </div>
    </section>

    <div class="settings-section-heading">
      <div>
        <p class="eyebrow">Step 2</p>
        <h3>Printer assignments</h3>
      </div>
      <p>Choose which physical printer handles billing and each preparation operation.</p>
    </div>
    <section class="settings-card settings-card--receipt-printer">
      <div class="settings-field-grid settings-field-grid--printer">
        <label>Billing & receipts<select name="receiptPrinterAssignment">${receiptPrinterOptions}</select></label>
      </div>
    </section>

    <div class="settings-section-heading">
      <div>
        <p class="eyebrow">Step 3</p>
        <h3>Prep stations & printer routes</h3>
      </div>
      <p>Each prep board can have its own ticket printer. Disable a board or printer without deleting its settings.</p>
    </div>
    <section class="settings-card settings-card--stations" aria-label="Prep station settings">
      ${stationRows || '<p class="empty-state">No prep stations are configured yet.</p>'}
    </section>

    <div class="settings-section-heading"><div><p class="eyebrow">Step 4</p><h3>Printer devices</h3></div><p>Add any number of printers once, then assign each operation above.</p></div>
    <section class="settings-card settings-card--stations" aria-label="Printer devices">${printerRows}</section>
    <section class="settings-card settings-card--add-station"><div><p class="eyebrow">Add printer</p><h3>New printer device</h3></div><div class="settings-field-grid settings-field-grid--printer"><label>Device name<input name="newPrinterName" placeholder="BBQ printer" /></label><label>Printer ID<input name="newPrinterId" placeholder="bbq-printer" /></label></div></section>

    <section class="settings-card settings-card--add-station">
      <div>
        <p class="eyebrow">Add station</p>
        <h3>New prep station</h3>
        <p class="muted">Add boards like Salad bar, Helper counter, Dessert, Coffee, or Pastry. It will initially use the billing printer; you can change its assignment after saving.</p>
      </div>
      <div class="settings-field-grid settings-field-grid--printer">
        <label>New station name<input name="newStationName" placeholder="Salad bar" /></label>
      </div>
    </section>

    <div class="settings-save-bar">
      <p class="form-error" hidden></p>
      <button type="submit">Save settings</button>
    </div>
  `;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const prepStations: SuperadminPrepStation[] = [];
    const printers: Record<string, SuperadminPrinterSettings> = {};
    const printerAssignments: Record<string, string> = {
      receipt: String(data.get('receiptPrinterAssignment') ?? 'receipt'),
    };

    form.querySelectorAll<HTMLElement>('.printer-device-card').forEach((card) => {
      const key = card.dataset.printerKey ?? '';
      printers[key] = {
        enabled: card.querySelector<HTMLInputElement>('input[name="printerEnabled"]')?.checked ?? true,
        printerId: card.querySelector<HTMLInputElement>('input[name="printerId"]')?.value ?? '',
        displayName: card.querySelector<HTMLInputElement>('input[name="printerDisplayName"]')?.value ?? '',
        connectionType: (() => {
          const value = card.querySelector<HTMLSelectElement>('select[name="printerConnection"]')?.value;
          const address = card.querySelector<HTMLInputElement>('input[name="printerAddress"]')?.value.trim();
          // An entered IP is an unambiguous physical-printer configuration. This also
          // repairs older setups that retained the default Simulator selection.
          if (value === 'network' || (value === 'simulator' && address)) return 'network';
          return value === 'windows' ? 'windows' : 'simulator';
        })(),
        windowsPrinterName: card.querySelector<HTMLInputElement>('input[name="windowsPrinterName"]')?.value ?? '',
        networkAddress: card.querySelector<HTMLInputElement>('input[name="printerAddress"]')?.value ?? '',
        networkPort: Number(card.querySelector<HTMLInputElement>('input[name="printerPort"]')?.value ?? 9100),
        copies: Number(card.querySelector<HTMLInputElement>('input[name="printerCopies"]')?.value ?? 1),
        autoPrint: card.querySelector<HTMLInputElement>('input[name="printerAutoPrint"]')?.checked ?? false,
      };
    });

    form.querySelectorAll<HTMLElement>('.station-settings-card[data-station-id]').forEach((card) => {
      const id = card.dataset.stationId ?? '';
      const station = {
        id,
        displayName: (card.querySelector<HTMLInputElement>('input[name="stationDisplayName"]')?.value ?? '').trim(),
        enabled: card.querySelector<HTMLInputElement>('input[name="stationEnabled"]')?.checked ?? true,
        sortOrder: Number(card.querySelector<HTMLInputElement>('input[name="stationSortOrder"]')?.value ?? 0),
      };
      prepStations.push(station);
      printerAssignments[id] = card.querySelector<HTMLSelectElement>('select[name="stationPrinterAssignment"]')?.value ?? 'receipt';
    });

    const newStationName = String(data.get('newStationName') ?? '').trim();
    if (newStationName) {
      const id = normalizeStationId(newStationName);
      prepStations.push({ id, displayName: newStationName, enabled: true, sortOrder: (prepStations.length + 1) * 10 });
      printerAssignments[id] = settings.printerAssignments.receipt;
    }

    const newPrinterName = String(data.get('newPrinterName') ?? '').trim();
    if (newPrinterName) {
      const key = normalizeStationId(newPrinterName);
      printers[key] = { enabled: true, printerId: String(data.get('newPrinterId') ?? '').trim() || key, displayName: newPrinterName, connectionType: 'simulator', networkPort: 9100, copies: 1, autoPrint: true };
    }

    try {
      await apiClient.updateSettings({
        pos: {
          restaurantBillInfo: {
            restaurantName: String(data.get('restaurantName') ?? ''),
            address: String(data.get('address') ?? ''),
            contact: String(data.get('contact') ?? ''),
            taxId: String(data.get('taxId') ?? ''),
            receiptFooter: String(data.get('receiptFooter') ?? ''),
          },
          prepStations,
          printers,
          printerAssignments,
        },
      });
      render();
    } catch (caught) {
      const error = form.querySelector<HTMLParagraphElement>('.form-error');
      if (error) {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : 'Unable to save settings.';
      }
    }
  });
  const preview = el('aside', 'settings-sidebar');
  preview.innerHTML = `
    <article class="card admin-card receipt-preview-card">
      <p class="eyebrow">Live receipt reference</p>
      <h3>Receipt preview</h3>
      <div class="receipt-preview-paper">
        <strong>${escapeHtml(info.restaurantName)}</strong>
        <span>${escapeHtml(info.address)}</span>
        <span>${escapeHtml(info.contact)}</span>
        ${info.taxId ? `<span>Tax ID: ${escapeHtml(info.taxId)}</span>` : ''}
        <hr>
        <span>Table 01 · Bill #0001</span>
        <span class="receipt-preview-paper__line">Items and totals print below</span>
        ${info.receiptFooter ? `<em>${escapeHtml(info.receiptFooter)}</em>` : ''}
      </div>
    </article>
    <article class="card admin-card settings-help-card">
      <h3>Setup checklist</h3>
      <ol>
        <li>Confirm the restaurant profile for receipt headers.</li>
        <li>Set the cashier receipt printer.</li>
        <li>Route each prep station to its own ticket printer.</li>
      </ol>
    </article>
  `;
  panel.append(form, preview);
  section.append(panel);
  return section;
}

type SalesHistoryPeriod = 'day' | 'week' | 'month';
type SalesHistoryTab = 'items' | 'invoices' | 'summary';

function isoDateOnly(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function dateRangeForPreset(preset: SalesHistoryPeriod | 'range'): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  if (preset === 'week') {
    const day = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - day + 1);
  }
  if (preset === 'month') start.setUTCDate(1);
  return preset === 'range' ? {} : { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

function endOfDateInput(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

function startOfDateInput(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

async function renderSalesHistory(): Promise<HTMLElement> {
  const params = new URLSearchParams(route.split('?')[1] ?? '');
  const period = (params.get('period') === 'week' || params.get('period') === 'month' ? params.get('period') : 'day') as SalesHistoryPeriod;
  const tabParam = params.get('tab');
  const activeTab = (tabParam === 'summary' || tabParam === 'invoices' ? tabParam : 'items') as SalesHistoryTab;
  const preset = (params.get('preset') === 'week' || params.get('preset') === 'month' || params.get('preset') === 'range' ? params.get('preset') : 'day') as SalesHistoryPeriod | 'range';
  const presetRange = dateRangeForPreset(preset);
  const dateFromInput = params.get('dateFrom') ?? (preset !== 'range' && presetRange.dateFrom ? presetRange.dateFrom.slice(0, 10) : isoDateOnly());
  const dateToInput = params.get('dateTo') ?? (preset !== 'range' && presetRange.dateTo ? presetRange.dateTo.slice(0, 10) : isoDateOnly());
  const dateFrom = startOfDateInput(dateFromInput) ?? presetRange.dateFrom;
  const dateTo = endOfDateInput(dateToInput) ?? presetRange.dateTo;

  const section = page('Sales history', 'Filter completed sales by today, this week, this month, or a custom date range. Review item categories alongside invoice amounts.');
  const panel = el('section', 'admin-panel sales-history-panel');
  const form = el('form', 'staff-form sales-history-filter');
  form.innerHTML = `
    <label>Quick filter
      <select name="preset">
        <option value="day" ${preset === 'day' ? 'selected' : ''}>Today</option>
        <option value="week" ${preset === 'week' ? 'selected' : ''}>This week</option>
        <option value="month" ${preset === 'month' ? 'selected' : ''}>This month</option>
        <option value="range" ${preset === 'range' ? 'selected' : ''}>Custom range</option>
      </select>
    </label>
    <label>Group by
      <select name="period">
        <option value="day" ${period === 'day' ? 'selected' : ''}>Day</option>
        <option value="week" ${period === 'week' ? 'selected' : ''}>Week</option>
        <option value="month" ${period === 'month' ? 'selected' : ''}>Month</option>
      </select>
    </label>
    <label>From<input name="dateFrom" type="date" value="${dateFromInput}" /></label>
    <label>To<input name="dateTo" type="date" value="${dateToInput}" /></label>
    <button type="submit">Apply filter</button>
    <p class="form-error" hidden></p>
  `;

  const tabs = el('div', 'sales-history-tabs');
  tabs.innerHTML = `
    <button type="button" class="${activeTab === 'items' ? 'active' : ''}" data-tab="items">Items by category</button>
    <button type="button" class="${activeTab === 'invoices' ? 'active' : ''}" data-tab="invoices">Invoices</button>
    <button type="button" class="${activeTab === 'summary' ? 'active' : ''}" data-tab="summary">Summary</button>
  `;

  const body = el('div', 'sales-history-body');
  try {
    const report = await apiClient.getSalesReport(period, { dateFrom, dateTo, branchId: session?.user.branchId });
    const rows = report.rows ?? [];
    const itemRows = rows.flatMap((row: any) => (row.items ?? []).map((item: any) => ({ ...item, periodLabel: row.periodLabel })));
    const invoiceRows = rows.flatMap((row: any) => (row.invoices ?? []).map((invoice: any) => ({ ...invoice, periodLabel: row.periodLabel })))
      .sort((a: any, b: any) => String(b.issuedAt ?? '').localeCompare(String(a.issuedAt ?? '')));

    if (activeTab === 'summary') {
      const topItems = [...itemRows].sort((a, b) => (b.grossSales ?? 0) - (a.grossSales ?? 0)).slice(0, 5);
      const summary = el('div', 'report-grid sales-summary-grid');
      summary.innerHTML = `
        <article class="card report-card"><h3>Total revenue</h3><p><strong>${money(report.summary?.revenue ?? 0)}</strong></p></article>
        <article class="card report-card"><h3>Orders</h3><p><strong>${report.summary?.orderCount ?? 0}</strong> orders</p></article>
        <article class="card report-card"><h3>Quantity sold</h3><p><strong>${report.summary?.quantitySold ?? 0}</strong> items</p></article>
        <article class="card report-card"><h3>Invoices</h3><p><strong>${report.summary?.invoiceCount ?? 0}</strong> invoices · ${money(report.summary?.invoiceTotal ?? 0)}</p></article>
      `;
      const topCard = el('article', 'card report-card sales-history-wide');
      topCard.innerHTML = `<h3>Top items</h3>${topItems.length ? `<ol>${topItems.map((item) => `<li><strong>${item.itemName}</strong> — ${item.quantitySold} sold · ${money(item.grossSales)}</li>`).join('')}</ol>` : '<p class="muted">No sales in this range.</p>'}`;
      summary.append(topCard);
      body.append(summary);
    } else if (activeTab === 'invoices') {
      const table = el('table', 'staff-table sales-history-table');
      table.innerHTML = '<thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th>Payments</th></tr></thead>';
      const tbody = el('tbody');
      if (!invoiceRows.length) {
        const row = el('tr');
        row.innerHTML = '<td colspan="7">No invoices found for this filter.</td>';
        tbody.append(row);
      }
      for (const invoice of invoiceRows) {
        const row = el('tr');
        row.innerHTML = `<td><strong>${invoice.invoiceId}</strong><br><small>${invoice.tableSessionId}</small></td><td>${new Date(invoice.issuedAt).toLocaleString()}</td><td>${money(invoice.amount ?? 0)}</td><td>${money(invoice.amountPaid ?? 0)}</td><td>${money(invoice.balanceDue ?? 0)}</td><td><span class="status-pill ${invoice.state}">${invoice.state}</span></td><td>${(invoice.paymentMethods ?? []).join(', ') || '—'}</td>`;
        tbody.append(row);
      }
      table.append(tbody);
      body.append(table);
    } else {
      const table = el('table', 'staff-table sales-history-table');
      table.innerHTML = '<thead><tr><th>Period</th><th>Item</th><th>Quantity</th><th>Gross sales</th><th>Orders</th></tr></thead>';
      const tbody = el('tbody');
      if (!itemRows.length) {
        const row = el('tr');
        row.innerHTML = '<td colspan="5">No sales found for this filter.</td>';
        tbody.append(row);
      }
      for (const item of itemRows) {
        const row = el('tr');
        row.innerHTML = `<td>${item.periodLabel}</td><td><strong>${item.itemName}</strong></td><td>${item.quantitySold}</td><td>${money(item.grossSales)}</td><td>${(item.orderIds ?? []).length}</td>`;
        tbody.append(row);
      }
      table.append(tbody);
      body.append(table);
    }
  } catch (caught) {
    body.append(el('p', 'pos-status', caught instanceof Error ? caught.message : 'Unable to load sales history.'));
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const next = new URLSearchParams();
    const nextPreset = String(data.get('preset') ?? 'day') as SalesHistoryPeriod | 'range';
    const nextRange = dateRangeForPreset(nextPreset);
    next.set('preset', nextPreset);
    next.set('period', String(data.get('period') ?? 'day'));
    next.set('tab', activeTab);
    next.set('dateFrom', nextPreset === 'range' ? String(data.get('dateFrom') ?? '') : (nextRange.dateFrom?.slice(0, 10) ?? ''));
    next.set('dateTo', nextPreset === 'range' ? String(data.get('dateTo') ?? '') : (nextRange.dateTo?.slice(0, 10) ?? ''));
    navigate(`#/sales-history?${next.toString()}`);
  });

  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => {
    params.set('tab', button.dataset.tab as SalesHistoryTab);
    if (!params.get('preset')) params.set('preset', preset);
    if (!params.get('period')) params.set('period', period);
    if (!params.get('dateFrom')) params.set('dateFrom', dateFromInput);
    if (!params.get('dateTo')) params.set('dateTo', dateToInput);
    navigate(`#/sales-history?${params.toString()}`);
  }));

  panel.append(form, tabs, body);
  section.append(panel);
  return section;
}

async function renderReports(): Promise<HTMLElement> {
  const section = page('Reporting center', 'A focused view of sales, service performance, inventory, and exceptions.');
  section.classList.add('reports-page');
  const todayRange = await loadCurrentBusinessDayRange();
  const defaultDate = todayRange.businessDate;
  const params = new URLSearchParams(route.split('?')[1] ?? '');
  const settingsResponse = await apiClient.getSettings() as RuntimeSettingsResponse;
  const operationalSettings = normalizeOperationalSettings(settingsResponse);
  const reportTimezone = settingsResponse.branch?.timezone ?? 'UTC';
  const form = el('form', 'staff-form report-filter-form report-toolbar');
  form.setAttribute('aria-label', 'Report filters');
  form.innerHTML = `
    <div class="report-filter-heading"><div><p class="eyebrow">Report controls</p><h2>Choose a reporting period</h2><p>Use the business date for daily close, or set a custom date and time range.</p></div><button type="submit">Run report</button></div>
    <div class="report-primary-filters">
    <label>Business date<input type="date" name="businessDate" value="${escapeHtml(params.get('businessDate') ?? defaultDate)}" required></label>
    <label>From<input type="datetime-local" name="dateFrom" value="${escapeHtml(params.get('dateFrom') ?? '')}"></label>
    <label>To<input type="datetime-local" name="dateTo" value="${escapeHtml(params.get('dateTo') ?? '')}"></label>
    <label>Branch<input name="branchId" value="${escapeHtml(params.get('branchId') ?? session?.user.branchId ?? '')}" placeholder="All branches"></label></div>
    <details class="report-advanced-filters"><summary>More filters <span>Shift, staff, service, station, and transaction details</span></summary><div class="report-filter-grid">
    <label>Shift<input name="shiftId" value="${escapeHtml(params.get('shiftId') ?? '')}" placeholder="All shifts"></label>
    <label>Cashier<input name="cashierUserId" value="${escapeHtml(params.get('cashierUserId') ?? '')}" placeholder="All cashiers"></label>
    <label>Waiter<input name="waiterUserId" value="${escapeHtml(params.get('waiterUserId') ?? '')}" placeholder="All waiters"></label>
    <label>Service mode<select name="serviceMode"><option value="">All modes</option><option value="dine_in" ${params.get('serviceMode') === 'dine_in' ? 'selected' : ''}>Dine in</option><option value="takeout" ${params.get('serviceMode') === 'takeout' ? 'selected' : ''}>Takeout</option></select></label>
    <label>Station<select name="stationId"><option value="">All stations</option>${operationalSettings.prepStations.filter((station) => station.enabled).map((station) => `<option value="${escapeHtml(station.id)}" ${params.get('stationId') === station.id ? 'selected' : ''}>${escapeHtml(station.displayName)}</option>`).join('')}</select></label>
    <label>Category<input name="category" value="${escapeHtml(params.get('category') ?? '')}" placeholder="All categories"></label>
    <label>Promotion<input name="promotionId" value="${escapeHtml(params.get('promotionId') ?? '')}" placeholder="Promotion ID"></label>
    <label>Hour interval<select name="intervalMinutes">${[15, 30, 60, 120].map((minutes) => `<option value="${minutes}" ${Number(params.get('intervalMinutes') ?? 60) === minutes ? 'selected' : ''}>${minutes} minutes</option>`).join('')}</select></label>
    <label>Order status<select name="orderStatus"><option value="">All statuses</option>${['pending', 'in_preparation', 'completed', 'delivered', 'cancelled'].map((status) => `<option value="${status}" ${params.get('orderStatus') === status ? 'selected' : ''}>${status.replace(/_/g, ' ')}</option>`).join('')}</select></label>
    <label>Payment method<select name="paymentMethod"><option value="">All methods</option>${['cash', 'card', 'wallet', 'bank_transfer', 'wave_money', 'kbzpay'].map((method) => `<option value="${method}" ${params.get('paymentMethod') === method ? 'selected' : ''}>${method.replace(/_/g, ' ')}</option>`).join('')}</select></label>
    <label>Exception type<select name="eventType"><option value="">All exceptions</option>${['payment_voids', 'refunds', 'order_cancellations', 'item_removals', 'comps_price_overrides'].map((type) => `<option value="${type}" ${params.get('eventType') === type ? 'selected' : ''}>${type.replace(/_/g, ' ')}</option>`).join('')}</select></label>
    <label>Reason<input name="reason" value="${escapeHtml(params.get('reason') ?? '')}" placeholder="Reason contains…"></label>
    </div></details>`;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = new URLSearchParams();
    new FormData(form).forEach((value, key) => { if (String(value).trim()) query.set(key, String(value)); });
    query.set('tab', params.get('tab') ?? 'summary');
    navigate(`#/reports?${query}`);
  });
  section.append(form);

  const reportNavigation = el('nav', 'report-tabs');
  reportNavigation.setAttribute('aria-label', 'Report sections');
  reportNavigation.setAttribute('role', 'tablist');
  const reportWorkspace = el('div', 'report-workspace');
  const reportSections = [
    ['summary', 'Overview', 'Daily close'],
    ['sales', 'Sales', 'Product mix'],
    ['operations', 'Operations', 'Stations & service'],
    ['inventory', 'Inventory', 'Stock & wastage'],
    ['exceptions', 'Exceptions', 'Manager review'],
  ] as const;
  const reportPanels = Object.fromEntries(reportSections.map(([id]) => {
    const panel = el('section', 'report-tab-panel');
    panel.id = `report-panel-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `report-tab-${id}`);
    return [id, panel];
  })) as Record<(typeof reportSections)[number][0], HTMLElement>;
  reportNavigation.innerHTML = reportSections.map(([id, label, description]) => `<button type="button" id="report-tab-${id}" role="tab" aria-controls="report-panel-${id}" data-report-tab="${id}"><span>${label}</span><small>${description}</small></button>`).join('');
  reportWorkspace.append(...reportSections.map(([id]) => reportPanels[id]));
  section.append(reportNavigation, reportWorkspace);

  const filters = Object.fromEntries(params.entries());
  if (!filters.businessDate) filters.businessDate = defaultDate;
  if (session?.user.branchId) filters.branchId = session.user.branchId;
  const report = await apiClient.getDailySummaryReport(filters);
  const summary = report.summary;
  const actions = el('div', 'page-actions daily-summary-actions');
  const printButton = el('button', 'secondary-button', 'Print report');
  printButton.type = 'button';
  printButton.addEventListener('click', async () => {
    await apiClient.auditReportExport(report.reportId, 'print', filters);
    if (!printReport(report.export as any, reportTimezone)) window.alert('Allow pop-ups to print this report.');
  });
  const csvButton = el('button', 'secondary-button', 'Download CSV');
  csvButton.type = 'button';
  csvButton.addEventListener('click', async () => {
    await apiClient.auditReportExport(report.reportId, 'csv', filters);
    downloadReportCsv(report.export as any, `daily-summary-${summary.businessDate}.csv`);
  });
  actions.append(printButton, csvButton);
  reportPanels.summary.append(actions);

  const reportBody = el('div', 'daily-summary-report');
  const grossToNet = el('article', 'card report-card');
  grossToNet.innerHTML = `<h2>Gross to net</h2><dl class="summary-ledger">
    <div><dt>Gross sales</dt><dd>${money(summary.grossSales)}</dd></div>
    <div><dt>Discounts</dt><dd>−${money(summary.discounts.total)}</dd></div>
    ${Object.entries(summary.discounts).filter(([key, value]) => key !== 'total' && Number(value)).map(([key, value]) => `<div class="muted"><dt>${key.replace(/([A-Z])/g, ' $1')}</dt><dd>−${money(Number(value))}</dd></div>`).join('')}
    <div><dt>Service charges</dt><dd>${money(summary.serviceCharges)}</dd></div>
    <div class="ledger-total"><dt>Net sales</dt><dd>${money(summary.netSales)}</dd></div><div><dt>Tax</dt><dd>${money(summary.tax)}</dd></div></dl>`;
  const tender = el('article', 'card report-card');
  tender.innerHTML = `<h2>Tender reconciliation</h2><dl class="summary-ledger">
    ${Object.entries(summary.paymentTotals).map(([method, amount]) => `<div><dt>${method.replace(/_/g, ' ')}</dt><dd>${money(Number(amount))}</dd></div>`).join('') || '<div><dt>No tenders recorded</dt><dd>—</dd></div>'}
    <div><dt>Refunds</dt><dd>−${money(summary.refunds)}</dd></div><div><dt>Voids</dt><dd>−${money(summary.voids)}</dd></div>
    <div class="ledger-total"><dt>Net tender</dt><dd>${money(summary.tenderedTotal)}</dd></div><div><dt>Variance</dt><dd>${money(summary.tenderVariance)}</dd></div></dl>`;
  const operations = el('article', 'card report-card');
  operations.innerHTML = `<h2>Day activity</h2><p><strong>${summary.orderCount}</strong> orders · <strong>${summary.invoiceCount}</strong> invoices${summary.guestCount === undefined ? '' : ` · <strong>${summary.guestCount}</strong> guests`}</p><p>Average check: <strong>${money(summary.averageCheck)}</strong></p><p>Debts: ${money(summary.debts)} · Outstanding: ${money(summary.outstandingBalances)}</p><p>First transaction: ${summary.firstTransactionAt ? new Date(summary.firstTransactionAt).toLocaleString() : '—'}<br>Last transaction: ${summary.lastTransactionAt ? new Date(summary.lastTransactionAt).toLocaleString() : '—'}</p>`;
  reportBody.append(grossToNet, tender, operations);
  reportPanels.summary.append(reportBody);

  const productMix = await apiClient.getProductMixReport(filters);
  const mixPanel = el('article', 'card report-card product-mix-report');
  mixPanel.innerHTML = `<h2>Product mix</h2><p class="muted">Actual selling prices and historical order snapshots are used. Contribution margin is estimated from recipe-linked inventory costs; incomplete rows are clearly flagged.</p>
    <div class="page-actions"><label>Group by <select data-mix-dimension>${[['menu_item','Menu item'],['category','Category'],['station','Prep station'],['service_mode','Service mode'],['weekday','Weekday'],['hour','Hour interval']].map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>View <select data-mix-view><option value="all">All</option><option value="top">Top 10</option><option value="bottom">Bottom 10</option></select></label><button type="button" class="secondary-button" data-mix-csv>Download CSV</button><button type="button" class="secondary-button" data-mix-print>Print</button></div>
    <p data-mix-warning class="pos-status"></p><div class="table-scroll" data-mix-table></div>`;
  const dimensionSelect = mixPanel.querySelector<HTMLSelectElement>('[data-mix-dimension]')!;
  const viewSelect = mixPanel.querySelector<HTMLSelectElement>('[data-mix-view]')!;
  const tableHost = mixPanel.querySelector<HTMLElement>('[data-mix-table]')!;
  const warning = mixPanel.querySelector<HTMLElement>('[data-mix-warning]')!;
  let sortKey = 'netSales'; let sortDirection = -1;
  const mixColumns: Array<[string, string, 'text' | 'money' | 'number']> = [['label','Group','text'],['quantity','Quantity','number'],['grossSales','Gross sales','money'],['discounts','Discounts','money'],['netSales','Net sales','money'],['percentageOfTotalSales','% sales','number'],['averageSellingPrice','Avg price','money'],['orderPenetration','Order penetration %','number'],['estimatedContributionMargin','Est. contribution','money'],['costDataStatus','Cost data','text']];
  const visibleMixRows = () => {
    const rows = [...((productMix.groups as any)[dimensionSelect.value] ?? [])].sort((a: any, b: any) => {
      const left = a[sortKey]; const right = b[sortKey];
      return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''))) * sortDirection;
    });
    return viewSelect.value === 'all' ? rows : (viewSelect.value === 'top' ? rows.sort((a: any,b: any) => b.netSales-a.netSales) : rows.sort((a: any,b: any) => a.netSales-b.netSales)).slice(0, 10);
  };
  const renderMixTable = () => {
    const rows = visibleMixRows();
    warning.textContent = productMix.summary.missingRecipeItemIds.length || productMix.summary.missingCostItemIds.length ? `Cost gaps — missing recipe: ${productMix.summary.missingRecipeItemIds.join(', ') || 'none'}; missing cost: ${productMix.summary.missingCostItemIds.join(', ') || 'none'}.` : 'Recipe cost coverage is complete.';
    tableHost.innerHTML = `<table><thead><tr>${mixColumns.map(([key,label]) => `<th><button type="button" class="table-sort" data-sort="${key}">${label}${sortKey === key ? (sortDirection > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead><tbody>${rows.map((row: any) => `<tr>${mixColumns.map(([key,,format]) => `<td>${row[key] === null ? 'Unavailable' : format === 'money' ? money(row[key]) : escapeHtml(String(row[key]))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${mixColumns.length}">No product-mix sales match these filters.</td></tr>`}</tbody></table>`;
    tableHost.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((button) => button.addEventListener('click', () => { const next = button.dataset.sort!; sortDirection = sortKey === next ? -sortDirection : (next === 'label' || next === 'costDataStatus' ? 1 : -1); sortKey = next; renderMixTable(); }));
  };
  dimensionSelect.addEventListener('change', renderMixTable); viewSelect.addEventListener('change', renderMixTable);
  mixPanel.querySelector<HTMLButtonElement>('[data-mix-print]')!.addEventListener('click', async () => {
    await apiClient.auditReportExport(productMix.reportId, 'print', filters);
    if (!printReport(productMix.export as any, reportTimezone)) window.alert('Allow pop-ups to print this report.');
  });
  mixPanel.querySelector<HTMLButtonElement>('[data-mix-csv]')!.addEventListener('click', async () => {
    await apiClient.auditReportExport(productMix.reportId, 'csv', filters);
    downloadReportCsv(productMix.export as any, `product-mix-${dimensionSelect.value}.csv`);
  });
  renderMixTable(); reportPanels.sales.append(mixPanel);

  const stationReport = await apiClient.getStationReport(filters);
  const stationPanel = el('article', 'card report-card station-report');
  stationPanel.innerHTML = `<h2>Station performance</h2><p class="muted">Sales use each order item's recorded station; KDS durations use durable progress timestamps.</p>
    <div class="exception-totals"><div><strong>Tickets</strong><span>${stationReport.summary.ticketCount}</span></div><div><strong>Average prep</strong><span>${stationReport.summary.averagePreparationSeconds}s</span></div><div><strong>P90 prep</strong><span>${stationReport.summary.p90PreparationSeconds}s</span></div><div><strong>Longest wait</strong><span>${stationReport.summary.longestWaitSeconds}s</span></div><div><strong>Active backlog</strong><span>${stationReport.summary.activeBacklog}</span></div><div><strong>Completed items</strong><span>${stationReport.summary.completedItems}</span></div><div><strong>Cancelled after prep</strong><span>${stationReport.summary.cancellationsAfterPreparation}</span></div><div><strong>Ready → delivered</strong><span>${stationReport.summary.averageReadyToDeliveredSeconds}s</span></div></div>
    <div class="table-scroll"><table><thead><tr><th>Station</th><th>Category</th><th>Item</th><th>Quantity</th><th>Sales</th><th>Orders</th></tr></thead><tbody>${stationReport.rows.map((row) => `<tr><td>${escapeHtml(row.stationId)}</td><td>${escapeHtml(row.categoryName)}</td><td>${escapeHtml(row.itemName)}</td><td>${row.quantitySold}</td><td>${money(row.grossSales)}</td><td>${row.orderCount}</td></tr>`).join('') || '<tr><td colspan="6">No station sales match these filters.</td></tr>'}</tbody></table></div>`;
  const stationCsv = el('button', 'secondary-button', 'Download station CSV');
  stationCsv.type = 'button';
  stationCsv.addEventListener('click', async () => {
    await apiClient.auditReportExport(stationReport.reportId, 'csv', filters);
    downloadReportCsv(stationReport.export as any, `station-report-${params.get('stationId') ?? 'all'}.csv`);
  });
  stationPanel.prepend(stationCsv);
  reportPanels.operations.append(stationPanel);

  const [inventoryControl, operationsReport] = await Promise.all([apiClient.getInventoryControlReport(filters), apiClient.getOperationsReport(filters)]);
  const inventoryPanel = el('article', 'card report-card exception-report');
  inventoryPanel.innerHTML = `<h2>Inventory control</h2><p class="muted">Stock valuation and actual usage are reconciled with sold recipe quantities. Missing mappings are exceptions, not zero-cost values.</p>
    ${(inventoryControl.summary.exceptionCount ?? 0) > 0 ? `<p class="report-exception"><strong>Mapping exceptions:</strong> ${inventoryControl.summary.missingRecipeItemIds.length} missing recipes · ${inventoryControl.summary.missingCostItemIds.length} missing costs</p>` : '<p class="report-ok">Recipe and cost mappings complete.</p>'}
    <div class="table-scroll"><table><thead><tr><th>Item</th><th>Closing stock</th><th>Unit cost</th><th>Value</th><th>Theoretical</th><th>Actual</th><th>Variance</th><th>Status</th></tr></thead><tbody>${inventoryControl.rows.map((row: any) => `<tr class="${row.costMappingStatus !== 'complete' ? 'exception-row' : ''}"><td>${escapeHtml(row.itemName)}</td><td>${row.closingStock} ${escapeHtml(row.unit)}</td><td>${row.unitCost === null ? 'Missing' : money(row.unitCost)}</td><td>${row.stockValue === null ? 'Unavailable' : money(row.stockValue)}</td><td>${row.theoreticalUsage}</td><td>${row.actualUsage}</td><td>${row.usageVariance}</td><td>${escapeHtml(row.costMappingStatus.replace(/_/g, ' '))}</td></tr>`).join('') || '<tr><td colspan="8">No inventory items match.</td></tr>'}</tbody></table></div>
    <h3>Wastage by reason</h3><div class="table-scroll"><table><thead><tr><th>Reason</th><th>Quantity</th><th>Cost</th></tr></thead><tbody>${inventoryControl.wastageByReason.map((row: any) => `<tr class="${row.missingCost ? 'exception-row' : ''}"><td>${escapeHtml(row.reason)}</td><td>${row.quantity}</td><td>${row.cost === null ? 'Unavailable' : money(row.cost)}</td></tr>`).join('') || '<tr><td colspan="3">No wastage recorded.</td></tr>'}</tbody></table></div>`;
  reportPanels.inventory.append(inventoryPanel);

  const operationsPanel = el('article', 'card report-card exception-report');
  const os: any = operationsReport.summary;
  operationsPanel.innerHTML = `<h2>Operations</h2><div class="exception-totals"><div><strong>Guests served</strong><span>${os.guestsServed}</span></div><div><strong>Average check</strong><span>${money(os.averageCheck)}</span></div><div><strong>Table turnover</strong><span>${os.averageTableTurnoverSeconds ?? 'Unavailable'}s</span></div><div><strong>Order → kitchen</strong><span>${os.averageOrderToKitchenSendSeconds ?? 'Unavailable'}s</span></div><div><strong>Preparation</strong><span>${os.averagePreparationSeconds ?? 'Unavailable'}s</span></div><div><strong>Ready → delivery</strong><span>${os.averageReadyToDeliverySeconds ?? 'Unavailable'}s</span></div></div>
    ${os.incompleteTimestamps.length || os.openTableSessions ? `<p class="report-exception"><strong>Operational exceptions:</strong> ${os.openTableSessions} open tables · ${os.incompleteTimestamps.length} incomplete timestamp chains</p>` : ''}
    <div class="table-scroll"><table><thead><tr><th>Waiter</th><th>Orders</th><th>Guests</th><th>Sales</th><th>Average check</th><th>Voids / cancellations</th><th>Rate</th></tr></thead><tbody>${operationsReport.rows.map((row: any) => `<tr class="${row.voidCancellationRate >= 10 ? 'exception-row' : ''}"><td>${escapeHtml(row.waiterUserId)}</td><td>${row.orderCount}</td><td>${row.guestsServed}</td><td>${money(row.sales)}</td><td>${money(row.averageCheck)}</td><td>${row.voidCancellationCount}</td><td>${row.voidCancellationRate}%</td></tr>`).join('') || '<tr><td colspan="7">No waiter activity matches.</td></tr>'}</tbody></table></div>`;
  reportPanels.operations.append(operationsPanel);

  const exceptions = await apiClient.getExceptionReport(filters);
  const exceptionPanel = el('article', 'card report-card exception-report');
  exceptionPanel.innerHTML = `<h2>Exceptions</h2><p class="muted">Manager review of voids, refunds, cancellations, removals, comps, and overrides.</p>
    <div class="exception-totals">${Object.entries(exceptions.summary.categoryTotals).map(([category, total]: [string, any]) => `<div><strong>${category.replace(/_/g, ' ')}</strong><span>${total.count} · ${money(total.amount)}</span></div>`).join('')}</div>
    <div class="table-scroll"><table><thead><tr><th>When</th><th>Type</th><th>Order / invoice</th><th>Table</th><th>Item / payment</th><th>Qty</th><th>Amount</th><th>Reason</th><th>Actor</th><th>Approver</th><th>Original ref.</th></tr></thead><tbody>
    ${exceptions.rows.map((row: any) => `<tr><td>${new Date(row.occurredAt).toLocaleString()}</td><td>${escapeHtml(row.category.replace(/_/g, ' '))}</td><td>${escapeHtml(row.orderId ?? '—')}<br><small>${escapeHtml(row.invoiceId ?? '')}</small></td><td>${escapeHtml(row.table ?? '—')}</td><td>${escapeHtml(row.itemOrPaymentMethod ?? '—')}</td><td>${row.quantity ?? '—'}</td><td>${money(row.amount)}</td><td>${escapeHtml(row.reason ?? '—')}</td><td>${escapeHtml(row.initiatingUserId ?? '—')}</td><td>${escapeHtml(row.approvingManagerId ?? '—')}</td><td>${escapeHtml(row.originalTransactionReference ?? '—')}</td></tr>`).join('') || '<tr><td colspan="11">No exceptions match these filters.</td></tr>'}
    </tbody></table></div>`;
  reportPanels.exceptions.append(exceptionPanel);
  const requestedTab = params.get('tab');
  const initialTab = reportSections.some(([id]) => id === requestedTab) ? requestedTab! : 'summary';
  const activateTab = (activeId: string, focus = false) => {
    reportNavigation.querySelectorAll<HTMLButtonElement>('[data-report-tab]').forEach((button) => {
      const active = button.dataset.reportTab === activeId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    reportSections.forEach(([id]) => { reportPanels[id].hidden = id !== activeId; });
    params.set('tab', activeId);
    const nextParams = new URLSearchParams(route.split('?')[1] ?? '');
    nextParams.set('tab', activeId);
    window.history.replaceState(null, '', `#/reports?${nextParams}`);
  };
  reportNavigation.querySelectorAll<HTMLButtonElement>('[data-report-tab]').forEach((button, index, buttons) => {
    button.addEventListener('click', () => activateTab(button.dataset.reportTab!));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      activateTab(buttons[nextIndex].dataset.reportTab!, true);
    });
  });
  activateTab(initialTab);
  return section;
}

async function renderAudit(): Promise<HTMLElement> {
  const section = page('Audit', 'Search audit history by keyword and inspect event summaries with before/after details.');
  const panel = el('section', 'admin-panel');
  const form = el('form', 'staff-form audit-filter-form');
  form.innerHTML = '<label>Search<input name="query" placeholder="order, payment, user, reason" /></label><label>Limit<input name="limit" type="number" value="50" min="1" /></label><button type="submit">Search audit</button>';
  const results = el('div', 'audit-results');
  async function load(filters = {}) {
    const state = await loadAdminAuditViewer(session!.user, { limit: 50, ...filters });
    results.replaceChildren();
    if (state.error) results.append(el('p', 'pos-status', state.error));
    if (!state.rows.length) results.append(emptyState(state.emptyState));
    for (const row of state.rows) {
      const card = el('article', 'card audit-card');
      card.innerHTML = `<h3>${row.action.replace(/_/g, ' ')}</h3><p>${row.summary}</p><details><summary>Snapshots</summary><pre>${row.beforeSnapshot}</pre><pre>${row.afterSnapshot}</pre></details>`;
      results.append(card);
    }
  }
  form.addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(form); await load({ query: String(data.get('query') ?? ''), limit: Number(data.get('limit') ?? 50) }); });
  await load();
  panel.append(form, results);
  section.append(panel);
  return section;
}

async function attachJsonPreview(container: HTMLElement, loader: () => Promise<unknown>): Promise<void> {
  const pre = el('pre', 'json-preview', 'Loading…');
  container.append(pre);
  try {
    pre.textContent = JSON.stringify(await loader(), null, 2);
  } catch (caught) {
    pre.textContent = caught instanceof Error ? caught.message : 'Unable to load data.';
  }
}


type MenuItemForPos = {
  id: string;
  name: string;
  price: number;
  prepStation?: string;
  isAvailable?: boolean;
};

type MenuCategoryForPos = {
  id: string;
  name: string;
  items: MenuItemForPos[];
};

function money(value: number): string {
  return `${Math.round(value).toLocaleString()} MMK`;
}

function findOpenOrder(orders: OrderRecord[], tableSessionId: string): OrderRecord | undefined {
  return orders.filter((order) => order.tableSessionId === tableSessionId && order.status !== 'cancelled').at(-1);
}

function orderItemsForBill(orders: OrderRecord[], tableSessionId: string, splitCount: number): Partial<Record<SplitLabel, TableOrderItem[]>> {
  const labels = ['A', 'B', 'C'] as SplitLabel[];
  const result: Partial<Record<SplitLabel, TableOrderItem[]>> = { A: [], B: [], C: [] };
  const items = orders
    .filter((order) => order.tableSessionId === tableSessionId && order.status !== 'cancelled')
    .flatMap((order) => order.items.map((item) => ({
      id: item.id,
      branchId: order.branchId,
      orderId: order.id,
      tableSessionId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTax: 0,
    })));

  items.forEach((item, index) => {
    const label = labels[index % splitCount];
    result[label]!.push(item);
  });
  return result;
}

async function advanceOrderThroughService(order: OrderRecord): Promise<OrderRecord> {
  let current = order;
  const flow: OrderStatus[] = current.status === 'pending'
    ? ['in_preparation', 'completed', 'delivered']
    : current.status === 'in_preparation'
      ? ['completed', 'delivered']
      : current.status === 'completed'
        ? ['delivered']
        : [];

  for (const nextStatus of flow) {
    current = await apiClient.transitionOrderStatus(session!.user.id, current.id, current.version, nextStatus);
  }
  return current;
}

async function addMenuItemToOrder(tableSessionId: string, menuItemId: string, activeOrder?: OrderRecord): Promise<void> {
  if (!session) return;
  if (!activeOrder || activeOrder.status === 'delivered') {
    await apiClient.createOrder(session.user.id, {
      serviceMode: 'dine_in',
      tableSessionId,
      items: [{ menuItemId, quantity: 1 }],
    });
  } else {
    await apiClient.editOrder(session.user.id, activeOrder.id, buildMenuItemAddition(activeOrder, menuItemId));
  }
  render();
}

async function changeOrderItemQuantity(order: OrderRecord, itemId: string, quantity: number): Promise<void> {
  if (!session) return;
  if (quantity <= 0) {
    await apiClient.editOrder(session.user.id, order.id, { expectedVersion: order.version, removeItemIds: [itemId], reason: 'POS remove item' });
  } else {
    await apiClient.editOrder(session.user.id, order.id, { expectedVersion: order.version, modifyItems: [{ id: itemId, quantity }], reason: 'POS quantity change' });
  }
  render();
}

async function payAndCleanTable(tableSessionId: string): Promise<void> {
  if (!session) return;
  const orders = await apiClient.listOrders();
  const linkedOrders = orders.filter((order) => order.tableSessionId === tableSessionId && order.status !== 'cancelled');
  if (!linkedOrders.length || !linkedOrders.some((order) => order.items.length)) throw new Error('Add menu items before taking payment.');

  for (const order of linkedOrders.filter((row) => row.status !== 'delivered')) {
    await advanceOrderThroughService(order);
  }

  const refreshedOrders = await apiClient.listOrders();
  try {
    await apiClient.createBill({
      tableSessionId,
      itemsBySplit: orderItemsForBill(refreshedOrders, tableSessionId, selectedSplitCount),
      pricing: { taxMode: 'taxable', taxRate: 0 },
    }, session.user.id);
  } catch (caught) {
    if (!(caught instanceof Error) || !/already exists/i.test(caught.message)) throw caught;
  }

  const receipt = await apiClient.getReceipt(tableSessionId);
  for (const split of receipt.splits) {
    const paid = split.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance = Math.round((split.calculationBreakdown.totalDue - paid) * 100) / 100;
    if (balance <= 0) continue;
    await apiClient.recordSplitPayment({
      tableSessionId,
      splitLabel: split.label,
      amount: balance,
      method: 'cash',
      createDebtForUnpaidBalance: false,
    }, session.user.id, `pos-paid-${tableSessionId}-${split.label}-${Date.now()}`);
  }
  await apiClient.closeTableSession(session.user.id, tableSessionId);
  selectedTableId = undefined;
  render();
}

function linkedOrdersForSession(orders: OrderRecord[], tableSessionId: string): OrderRecord[] {
  return orders.filter((order) => order.tableSessionId === tableSessionId && order.status !== 'cancelled');
}

function tableSubtotal(orders: OrderRecord[], tableSessionId: string): number {
  return linkedOrdersForSession(orders, tableSessionId).reduce((sum, order) => sum + order.subtotal, 0);
}


type PreparationSummary = {
  label: string;
  tone: string;
};

function preparationSummaryForSession(orders: OrderRecord[], tableSessionId?: string, snapshot?: KdsSnapshot): PreparationSummary {
  if (!tableSessionId) return { label: 'Available', tone: 'ready' };
  const linkedOrders = linkedOrdersForSession(orders, tableSessionId);
  if (!linkedOrders.length || !linkedOrders.some((order) => order.items.length)) return { label: 'Open table', tone: 'queued' };
  if (linkedOrders.every((order) => order.status === 'delivered')) return { label: 'Delivered', tone: 'served' };
  const orderIds = new Set(linkedOrders.map((order) => order.id));
  const kdsItems = snapshot?.groups.flatMap((group) => group.items).filter((item) => orderIds.has(item.orderId)) ?? [];
  if (kdsItems.length) {
    if (kdsItems.every((item) => item.progress === 'ready' || item.progress === 'served')) return { label: 'Ready', tone: 'ready' };
    if (kdsItems.some((item) => item.progress === 'preparing')) return { label: 'Preparing', tone: 'preparing' };
    return { label: 'Queued', tone: 'queued' };
  }
  if (linkedOrders.some((order) => order.status === 'in_preparation')) return { label: 'Preparing', tone: 'preparing' };
  if (linkedOrders.some((order) => order.status === 'completed')) return { label: 'Ready', tone: 'ready' };
  return { label: 'Queued', tone: 'queued' };
}

function tableTileMarkup(row: TableFloorState, orders: OrderRecord[], snapshot?: KdsSnapshot): string {
  const prep = preparationSummaryForSession(orders, row.activeSession?.id, snapshot);
  const detail = row.activeSession ? `${row.activeSession.guestCount} guests` : `${row.table.capacity} seats`;
  return `<strong>${row.table.name}</strong><span>${row.status}</span><span class="prep-label ${prep.tone}">${prep.label}</span><small>${detail}</small>`;
}

function fallbackLayoutPosition(index: number): { left: number; top: number } {
  return {
    left: 8 + (index % 4) * 23,
    top: 10 + Math.floor(index / 4) * 28,
  };
}

function tableLayoutPosition(row: TableFloorState, index: number): { left: number; top: number } {
  const fallback = fallbackLayoutPosition(index);
  return {
    left: Math.min(row.table.layoutX ?? fallback.left, 96),
    top: Math.min(row.table.layoutY ?? fallback.top, 96),
  };
}

function positionFloorTable(button: HTMLElement, row: TableFloorState, index: number): void {
  const position = tableLayoutPosition(row, index);
  button.style.left = `${position.left}%`;
  button.style.top = `${position.top}%`;
}

interface TableLayoutFlowCallbacks {
  onNodeSelect: (tableId: string) => void;
  onNodeMove: (tableId: string, layoutX: number, layoutY: number) => void;
  onNodeSave: (tableId: string, position: { layoutX: number; layoutY: number }) => Promise<void>;
}

interface TableLayoutFlowOptions {
  editable?: boolean;
  orders?: OrderRecord[];
  kdsSnapshot?: KdsSnapshot;
  ariaLabel?: string;
  emptyMessage?: string;
}

function createTableLayoutFlow(tables: TableFloorState[], options: TableLayoutFlowOptions = {}): HTMLElement {
  const editable = options.editable ?? true;
  const flow = el('div', `react-flow table-layout-flow ${editable ? 'floor-plan--editable' : 'table-layout-flow--readonly'}`);
  flow.dataset.reactFlow = 'table-layout';
  flow.setAttribute('role', 'application');
  flow.setAttribute('aria-label', options.ariaLabel ?? (editable ? 'React Flow table layout editor' : 'React Flow table floor layout'));

  const viewport = el('div', 'react-flow__viewport table-layout-flow__viewport');
  const nodesLayer = el('div', 'react-flow__nodes table-layout-flow__nodes');
  viewport.append(nodesLayer);
  flow.append(viewport);

  const grid = el('div', 'react-flow__background table-layout-flow__background');
  flow.prepend(grid);

  if (editable) {
    const toolbar = el('div', 'react-flow__controls table-layout-flow__controls');
    toolbar.innerHTML = `
      <button type="button" data-flow-action="zoom-out" aria-label="Zoom out">−</button>
      <button type="button" data-flow-action="fit" aria-label="Fit view">Fit</button>
      <button type="button" data-flow-action="zoom-in" aria-label="Zoom in">+</button>
    `;
    flow.append(toolbar);
  }

  if (!tables.length) {
    const empty = emptyState(options.emptyMessage ?? 'No tables yet. Create one to start the layout.');
    empty.classList.add('table-layout-flow__empty');
    flow.append(empty);
    return flow;
  }

  tables.forEach((row, index) => {
    const position = tableLayoutPosition(row, index);
    const node = el('button', `react-flow__node table-layout-node ${editable ? '' : 'table-layout-node--readonly'} table-tile ${row.status}`);
    node.type = 'button';
    node.dataset.tableId = row.table.id;
    node.dataset.layoutX = String(position.left);
    node.dataset.layoutY = String(position.top);
    node.style.left = `${position.left}%`;
    node.style.top = `${position.top}%`;
    node.innerHTML = tableTileMarkup(row, options.orders ?? [], options.kdsSnapshot);
    nodesLayer.append(node);
  });

  return flow;
}

function bindTableLayoutFlow(flow: HTMLElement, callbacks: TableLayoutFlowCallbacks): void {
  const viewport = flow.querySelector<HTMLElement>('.table-layout-flow__viewport');
  const nodesLayer = flow.querySelector<HTMLElement>('.table-layout-flow__nodes');
  if (!viewport || !nodesLayer) return;
  const viewportEl = viewport;
  const nodesLayerEl = nodesLayer;

  let zoom = 1;
  let activeDrag: { node: HTMLButtonElement; pointerId: number; grabbedOffsetX: number; grabbedOffsetY: number; moved: boolean; startX: number; startY: number } | undefined;

  function setZoom(nextZoom: number): void {
    zoom = Math.max(0.75, Math.min(1.35, nextZoom));
    nodesLayerEl.style.transform = `scale(${zoom})`;
  }

  function positionFromPointer(event: PointerEvent, node: HTMLElement): { layoutX: number; layoutY: number } {
    const rect = viewportEl.getBoundingClientRect();
    const offsetX = activeDrag?.grabbedOffsetX ?? node.offsetWidth / 2;
    const offsetY = activeDrag?.grabbedOffsetY ?? node.offsetHeight / 2;
    const nodeCenterX = event.clientX - rect.left - offsetX + node.offsetWidth / 2;
    const nodeCenterY = event.clientY - rect.top - offsetY + node.offsetHeight / 2;
    return {
      layoutX: Math.round(Math.max(4, Math.min(96, (nodeCenterX / rect.width) * 100))),
      layoutY: Math.round(Math.max(4, Math.min(96, (nodeCenterY / rect.height) * 100))),
    };
  }

  function updateNodePosition(node: HTMLElement, layoutX: number, layoutY: number): void {
    node.dataset.layoutX = String(layoutX);
    node.dataset.layoutY = String(layoutY);
    node.style.left = `${layoutX}%`;
    node.style.top = `${layoutY}%`;
  }

  function selectNode(node: HTMLButtonElement): void {
    flow.querySelectorAll('.table-layout-node.selected').forEach((selected) => selected.classList.remove('selected'));
    node.classList.add('selected');
    callbacks.onNodeSelect(node.dataset.tableId!);
  }

  flow.querySelectorAll<HTMLButtonElement>('.table-layout-node').forEach((node) => {
    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const nodeRect = node.getBoundingClientRect();
      activeDrag = {
        node,
        pointerId: event.pointerId,
        grabbedOffsetX: event.clientX - nodeRect.left,
        grabbedOffsetY: event.clientY - nodeRect.top,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
      };
      selectNode(node);
      node.setPointerCapture(event.pointerId);
      node.classList.add('dragging');
      event.preventDefault();
    });

    node.addEventListener('pointermove', (event) => {
      if (!activeDrag || activeDrag.node !== node || activeDrag.pointerId !== event.pointerId) return;
      if (Math.abs(event.clientX - activeDrag.startX) > 2 || Math.abs(event.clientY - activeDrag.startY) > 2) activeDrag.moved = true;
      const position = positionFromPointer(event, node);
      updateNodePosition(node, position.layoutX, position.layoutY);
      callbacks.onNodeMove(node.dataset.tableId!, position.layoutX, position.layoutY);
    });

    node.addEventListener('pointerup', async (event) => {
      if (!activeDrag || activeDrag.node !== node || activeDrag.pointerId !== event.pointerId) return;
      const drag = activeDrag;
      const position = positionFromPointer(event, node);
      activeDrag = undefined;
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      node.classList.remove('dragging');
      if (!drag.moved) return;
      updateNodePosition(node, position.layoutX, position.layoutY);
      callbacks.onNodeMove(node.dataset.tableId!, position.layoutX, position.layoutY);
      await callbacks.onNodeSave(node.dataset.tableId!, position);
    });

    node.addEventListener('pointercancel', (event) => {
      if (!activeDrag || activeDrag.node !== node || activeDrag.pointerId !== event.pointerId) return;
      activeDrag = undefined;
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      node.classList.remove('dragging');
    });

    node.addEventListener('click', () => selectNode(node));
  });

  flow.querySelectorAll<HTMLButtonElement>('[data-flow-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.flowAction;
      if (action === 'zoom-in') setZoom(zoom + 0.1);
      if (action === 'zoom-out') setZoom(zoom - 0.1);
      if (action === 'fit') setZoom(1);
    });
  });
}

function renderOrderedItemsReview(orders: OrderRecord[], snapshot?: KdsSnapshot): HTMLElement {
  const totalItems = orders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
  const review = el('section', 'ordered-items-review');
  const heading = el('div', 'ordered-items-review__heading');
  const headingText = el('div');
  headingText.append(el('span', 'eyebrow', 'Customer ordered'));
  headingText.append(el('h4', '', 'Items to double-check'));
  heading.append(headingText, el('strong', '', `${totalItems} items · ${money(orders.reduce((sum, order) => sum + order.subtotal, 0))}`));
  review.append(heading);

  const list = el('div', 'ordered-items-review__list');
  for (const order of orders) {
    for (const item of order.items) {
      const row = el('div', 'ordered-item-row');
      const detail = el('div');
      detail.append(el('strong', '', `${item.quantity}× ${item.name}`));
      const itemMeta = [`${money(item.unitPrice)} each`, `Order ${order.id.slice(-8)}`, orderItemPreparationStatus(order, item.id, snapshot)];
      if (item.note) itemMeta.push(item.note);
      detail.append(el('small', '', itemMeta.join(' · ')));
      row.append(detail, el('strong', '', money(item.lineTotal)));
      list.append(row);
    }
  }
  review.append(list);
  return review;
}

function renderPreviousOrders(orders: OrderRecord[], activeOrder: OrderRecord | undefined, snapshot?: KdsSnapshot): HTMLElement | undefined {
  const previous = orders
    .filter((order) => order.id !== activeOrder?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!previous.length) return undefined;

  const history = el('section', 'previous-orders');
  history.innerHTML = `<div class="previous-orders__heading"><div><span class="eyebrow">Already ordered</span><h4>Previous orders</h4></div><span>${previous.length} ${previous.length === 1 ? 'order' : 'orders'}</span></div>`;
  for (const order of previous) {
    const card = el('article', 'previous-order-card');
    const statusLabel = order.status.replace(/_/g, ' ');
    card.innerHTML = `<div class="previous-order-card__heading"><div><strong>Order ${escapeHtml(order.id.slice(-8))}</strong><small>${new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div><span class="order-status order-status--${order.status.replace(/_/g, '-')}">${translateUiHtml(statusLabel)}</span></div>`;
    const items = el('div', 'previous-order-items');
    for (const item of order.items) {
      const itemStatus = orderItemPreparationStatus(order, item.id, snapshot);
      const row = el('div', 'previous-order-item');
      row.innerHTML = `<span><strong>${item.quantity}× ${escapeHtml(item.name)}</strong><small>${translateUiHtml(itemStatus)}</small></span><strong>${money(item.lineTotal)}</strong>`;
      items.append(row);
    }
    if (!order.items.length) items.append(el('p', 'muted', 'No items on this order.'));
    card.append(items);
    history.append(card);
  }
  return history;
}

async function advanceSessionOrdersForClose(tableSessionId: string): Promise<void> {
  const orders = await apiClient.listOrders();
  for (const order of linkedOrdersForSession(orders, tableSessionId).filter((row) => row.status !== 'delivered')) {
    await advanceOrderThroughService(order);
  }
}

async function createBillForSession(tableSessionId: string): Promise<void> {
  if (!session) return;
  const orders = await apiClient.listOrders();
  const linkedOrders = linkedOrdersForSession(orders, tableSessionId);
  if (!linkedOrders.length || !linkedOrders.some((order) => order.items.length)) throw new Error('Add menu items before preparing the bill.');
  await apiClient.createBill({
    tableSessionId,
    itemsBySplit: splitDraftSelections[tableSessionId] ?? orderItemsForBill(orders, tableSessionId, selectedSplitCount),
  }, session.user.id);
}

function renderSplitItemAssignment(tableSessionId: string, orders: OrderRecord[], existing?: ReceiptPayload): HTMLElement {
  const labels = ['A', 'B', 'C'] as SplitLabel[];
  const source = existing
    ? existing.splits.flatMap((split) => split.lines.map((line) => ({ id: line.orderItemId, orderId: 'existing', tableSessionId, name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, itemDiscount: line.discounts.itemLevel, comboDiscount: line.discounts.combo, happyHourDiscount: line.discounts.happyHour } as TableOrderItem & { currentSplit?: SplitLabel })).map((item) => ({ ...item, currentSplit: existing.splits.find((split) => split.lines.some((line) => line.orderItemId === item.id))?.label ?? 'A' })))
    : orderItemsForBill(orders, tableSessionId, selectedSplitCount);
  const current = splitDraftSelections[tableSessionId] ?? (existing ? labels.reduce((acc, label) => ({ ...acc, [label]: (source as (TableOrderItem & { currentSplit?: SplitLabel })[]).filter((item) => item.currentSplit === label) }), {} as Partial<Record<SplitLabel, TableOrderItem[]>>) : source as Partial<Record<SplitLabel, TableOrderItem[]>>);
  splitDraftSelections[tableSessionId] = current;
  const allItems = labels.flatMap((label) => (current[label] ?? []).map((item) => ({ ...item, assignedSplit: label })));
  const box = el('div', 'split-assignment-panel');
  box.innerHTML = `<h4>Assign specific menu items to split bills</h4><p class="muted">Change quantities or move items between splits. Use Back/other navigation freely; this draft is preserved until you prepare or update the bill.</p>`;
  for (const item of allItems) {
    const row = el('div', 'bill-line-row');
    row.innerHTML = `<label><input type="checkbox" checked> ${item.name}</label><input name="qty" type="number" min="0.01" step="0.01" value="${item.quantity}" aria-label="Quantity for ${item.name}"><select>${labels.slice(0, selectedSplitCount).map((label) => `<option value="${label}" ${label === item.assignedSplit ? 'selected' : ''}>Split ${label}</option>`).join('')}</select>`;
    const saveDraft = () => {
      const checked = row.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked;
      const qty = Number(row.querySelector<HTMLInputElement>('input[name=qty]')!.value);
      const nextLabel = row.querySelector<HTMLSelectElement>('select')!.value as SplitLabel;
      for (const label of labels) current[label] = (current[label] ?? []).filter((x) => x.id !== item.id);
      if (checked && Number.isFinite(qty) && qty > 0) current[nextLabel] = [...(current[nextLabel] ?? []), { ...item, quantity: qty }];
    };
    row.querySelectorAll('input,select').forEach((control) => control.addEventListener('change', saveDraft));
    box.append(row);
  }
  return box;
}

function renderPrintPreview(tableSessionId: string, receipt: ReceiptPayload, splitLabel?: SplitLabel): HTMLElement {
  const activeSplits = receipt.splits.filter((split) => split.lines.length || split.calculationBreakdown.totalDue > 0);
  const selectedSplit = splitLabel ? activeSplits.find((split) => split.label === splitLabel) : activeSplits[0];
  const breakdown = selectedSplit?.calculationBreakdown ?? receipt.calculationBreakdown;
  const panel = el('section', 'pos-panel print-preview-panel');
  panel.innerHTML = `<div class="pos-panel-heading"><h3>Print preview${activeSplits.length > 1 ? ` · Split ${splitLabel}` : ''}</h3><span>Confirm before printing</span></div><div class="receipt-preview-paper"><strong>${receipt.restaurant.restaurantName}</strong><span>${new Date(receipt.generatedAt).toLocaleString()}</span>${receipt.tableName ? `<strong class="receipt-preview-paper__table">Table: ${escapeHtml(receipt.tableName)}</strong>` : ''}${breakdown.lines.map((line) => `<div class="receipt-preview-paper__line">${line.quantity}× ${line.name} — ${money(line.lineTotal)}</div>`).join('')}<hr><span>Subtotal ${money(breakdown.subtotal)}</span><span>Discount ${money(breakdown.discounts.total)}</span><span>Tax ${money(breakdown.taxTotal)}</span><strong>Total ${money(breakdown.totalDue)}</strong></div><div class="billing-actions"><button type="button" class="secondary cancel-print">Cancel</button><button type="button" class="billing-action confirm-print">Confirm print</button></div>`;
  panel.querySelector<HTMLButtonElement>('.cancel-print')?.addEventListener('click', () => { pendingPrintPreview = undefined; render(); });
  panel.querySelector<HTMLButtonElement>('.confirm-print')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      await runButtonAction(button, { loading: 'Sending receipt to printer…', success: 'Receipt sent to the printer.', error: 'Unable to print receipt.' }, async () => {
        await apiClient.printReceipt(tableSessionId, { copies: 1, splitLabel }, session!.user.id);
        pendingPrintPreview = undefined;
        render();
      });
    } catch { /* The toast provides the actionable error without closing the preview. */ }
  });
  return panel;
}

async function renderOrderStation(): Promise<HTMLElement> {
  const section = page('Order station', 'Choose a table and move straight into ordering. Built for quick service on tablets and phones.');
  section.classList.add('order-station-page');

  const [floor, orders, kdsSnapshot] = await Promise.all([
    loadCashierTableFloor(session!.user.branchId),
    apiClient.listOrders(),
    apiClient.getKdsSnapshot(undefined, 'all'),
  ]);
  const activeTables = floor.tables.filter((row) => row.status !== 'inactive');
  if (!selectedTableId || !activeTables.some((row) => row.table.id === selectedTableId)) {
    selectedTableId = activeTables.find((row) => row.status === 'occupied')?.table.id ?? activeTables[0]?.table.id;
  }
  const selected = activeTables.find((row) => row.table.id === selectedTableId);

  const intro = el('section', 'order-station-hero');
  intro.innerHTML = `
    <div><p class="eyebrow">${translateUiHtml('Service mode')}</p><h3>${translateUiHtml('Tap a table. Start an order.')}</h3><p>${translateUiHtml(`${floor.counts.occupied} in service · ${floor.counts.available} ready for guests`)}</p></div>
    <button type="button" class="view-progress">${translateUiHtml('View order progress')}</button>
  `;
  intro.querySelector<HTMLButtonElement>('.view-progress')?.addEventListener('click', () => navigate('#/waiter-progress'));

  const workspace = el('div', 'order-station-workspace');
  const tablesPanel = el('section', 'pos-panel order-station-tables');
  tablesPanel.innerHTML = '<div class="pos-panel-heading"><h3>Select a table</h3><span>Occupied tables appear first</span></div>';
  const tableGrid = el('div', 'table-grid order-station-grid');
  [...activeTables].sort((a, b) => Number(b.status === 'occupied') - Number(a.status === 'occupied')).forEach((row) => {
    const button = el('button', `table-tile ${row.status} ${row.table.id === selected?.table.id ? 'selected' : ''}`);
    button.type = 'button';
    button.innerHTML = tableTileMarkup(row, orders, kdsSnapshot);
    button.addEventListener('click', () => {
      selectedTableId = row.table.id;
      render();
    });
    tableGrid.append(button);
  });
  if (!activeTables.length) tableGrid.append(emptyState('No active tables are configured yet.'));
  tablesPanel.append(tableGrid);

  const actionPanel = el('aside', 'pos-panel order-station-action');
  if (!selected) {
    actionPanel.innerHTML = '<p class="eyebrow">Next step</p><h3>Select a table</h3><p class="muted">Choose an active table to begin.</p>';
  } else if (selected.activeSession) {
    const currentOrder = findOpenOrder(orders, selected.activeSession.id);
    const itemCount = currentOrder?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
    const prep = preparationSummaryForSession(orders, selected.activeSession.id, kdsSnapshot);
    actionPanel.innerHTML = `<p class="eyebrow">Continue service</p><h3>${escapeHtml(selected.table.name)}</h3><div class="order-station-summary"><span>${selected.activeSession.guestCount} guests</span><span>${itemCount} items</span><span class="badge ${prep.tone}">${translateUiHtml(prep.label)}</span></div><p class="muted">Return to this table’s active ticket and add the next round.</p><button type="button" class="station-primary">${translateUiHtml('Continue order')}</button>`;
    actionPanel.querySelector<HTMLButtonElement>('.station-primary')?.addEventListener('click', () => navigate('#/orders'));
  } else {
    actionPanel.innerHTML = `<p class="eyebrow">Start service</p><h3>${escapeHtml(selected.table.name)}</h3><p class="muted">${selected.table.capacity} seats available. Set the party size, then start taking the order.</p>`;
    const form = el('form', 'order-station-open-form');
    form.innerHTML = `<label>Guests<input name="guestCount" type="number" inputmode="numeric" min="1" max="${selected.table.capacity}" value="${Math.min(2, selected.table.capacity)}" required /></label><button type="submit" class="station-primary">${translateUiHtml('Open table & order')}</button><p class="form-error" hidden></p>`;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = form.querySelector<HTMLParagraphElement>('.form-error')!;
      try {
        const guestCount = Number(new FormData(form).get('guestCount'));
        await apiClient.openTableSession(session!.user.id, selected.table.id, guestCount, session!.user.branchId);
        navigate('#/orders');
      } catch (caught) {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : 'Unable to open table.';
      }
    });
    actionPanel.append(form);
  }

  workspace.append(tablesPanel, actionPanel);
  section.append(intro, workspace);
  return section;
}

async function renderOrderEntry(): Promise<HTMLElement> {
  const section = page('Order', 'Open tables, add guest items, and track preparation status without billing controls.');
  section.classList.add('pos-page');

  const status = el('p', 'pos-status');
  status.hidden = true;
  const workspace = el('div', 'pos-workspace order-entry-workspace');
  section.append(status, workspace);

  const [floor, menu, orders, kdsSnapshot] = await Promise.all([
    loadCashierTableFloor(session!.user.branchId),
    apiClient.listMenu() as Promise<MenuCategoryForPos[]>,
    apiClient.listOrders(),
    apiClient.getKdsSnapshot(undefined, 'all'),
  ]);
  if (!selectedTableId) selectedTableId = floor.tables.find((row) => row.status !== 'inactive')?.table.id;
  const selected = floor.tables.find((row) => row.table.id === selectedTableId) ?? floor.tables[0];
  // Only pending orders are editable drafts. Once a waiter submits a round, the
  // next menu tap starts a clean order instead of adding to the submitted round.
  const activeOrder = selected?.activeSession
    ? orders.filter((order) => order.tableSessionId === selected.activeSession!.id && order.status === 'pending').at(-1)
    : undefined;

  const floorPanel = el('section', 'pos-panel table-panel');
  floorPanel.innerHTML = `<div class="pos-panel-heading"><div><h3>${selected ? `Ordering for ${escapeHtml(selected.table.name)}` : 'Tables for ordering'}</h3><span>${floor.counts.available} available · ${floor.counts.occupied} occupied</span></div>${selected ? '<button type="button" class="secondary change-order-table" aria-expanded="false">Change table</button>' : ''}</div>`;
  const tableList = el('div', 'table-grid order-table-list');
  floor.tables.forEach((row) => {
    const button = el('button', `table-tile ${row.status} ${row.table.id === selected?.table.id ? 'selected' : ''}`);
    button.type = 'button';
    button.innerHTML = tableTileMarkup(row, orders, typeof kdsSnapshot !== 'undefined' ? kdsSnapshot : undefined);
    button.addEventListener('click', () => {
      selectedTableId = row.table.id;
      render();
    });
    tableList.append(button);
  });
  if (!floor.tables.length) tableList.append(emptyState('No tables configured.'));
  floorPanel.append(tableList);
  if (selected) {
    floorPanel.classList.add('table-panel--collapsed');
    workspace.classList.add('table-selection-collapsed');
    const changeTableButton = floorPanel.querySelector<HTMLButtonElement>('.change-order-table')!;
    changeTableButton.addEventListener('click', () => {
      const expanded = floorPanel.classList.toggle('table-panel--expanded');
      changeTableButton.setAttribute('aria-expanded', String(expanded));
      changeTableButton.textContent = expanded ? 'Hide tables' : 'Change table';
    });
  }

  const orderPanel = el('section', 'pos-panel order-panel');
  if (!selected) {
    orderPanel.innerHTML = '<h3>No tables configured</h3><p>Starter data will be seeded at sign-in. Refresh or sign in again if this remains empty.</p>';
  } else if (!selected.activeSession) {
    orderPanel.innerHTML = `<h3>${selected.table.name}</h3><p class="muted">Available table. Open it to start a guest order.</p>`;
    const openForm = el('form', 'open-table-form');
    openForm.innerHTML = '<label>Guests<input name="guestCount" type="number" min="1" value="2" /></label><button type="submit">Open table for order</button>';
    openForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const guestCount = Number(new FormData(openForm).get('guestCount') ?? 1);
      try {
        await apiClient.openTableSession(session!.user.id, selected.table.id, guestCount, session!.user.branchId);
        render();
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to open table.';
      }
    });
    orderPanel.append(openForm);
  } else {
    orderPanel.innerHTML = `<div class="pos-panel-heading"><h3>${selected.table.name} active order</h3><span>${selected.activeSession.guestCount} guests · send items from menu</span></div>`;
    const sessionOrders = orders.filter((order) => order.tableSessionId === selected.activeSession!.id);
    const cart = el('div', 'cart-list');
    if (!activeOrder?.items.length) cart.append(el('p', 'muted', 'Tap menu items to start this table order.'));
    for (const item of activeOrder?.items ?? []) {
      const row = el('div', 'cart-row');
      const orderStatus = activeOrder ? orderItemPreparationStatus(activeOrder, item.id, kdsSnapshot) : 'new';
      row.innerHTML = `<div><strong>${item.name}</strong><small>${money(item.unitPrice)} each · ${orderStatus}</small></div><div class="quantity-controls"><button type="button" data-delta="-1">−</button><span>${item.quantity}</span><button type="button" data-delta="1">+</button></div><strong>${money(item.lineTotal)}</strong>`;
      row.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => {
        void changeOrderItemQuantity(activeOrder!, item.id, item.quantity + Number(button.dataset.delta));
      }));
      cart.append(row);
    }
    const orderSummary = el('div', 'checkout-box order-summary-box');
    orderSummary.innerHTML = `
      <div><span>Order subtotal</span><strong>${money(activeOrder?.subtotal ?? 0)}</strong></div>
      <button type="button" class="save-order" ${activeOrder?.items.length ? '' : 'disabled'}>Save order & print tickets</button>
      <p class="muted">Save sends prep tickets to configured station printers. Billing and table closing stay with the cashier.</p>
    `;
    orderSummary.querySelector<HTMLButtonElement>('.save-order')?.addEventListener('click', async (event) => {
      const submitButton = event.currentTarget as HTMLButtonElement;
      if (!window.confirm(`Submit ${activeOrder!.items.reduce((sum, item) => sum + item.quantity, 0)} item(s) for ${selected.table.name}?`)) return;
      try {
        await runButtonAction(submitButton, { loading: 'Saving order & printing…', success: `Order confirmed for ${selected.table.name}.`, error: 'Unable to print order tickets.' }, async () => {
          await apiClient.printOrderTickets(session!.user.id, activeOrder!.id);
          await apiClient.transitionOrderStatus(session!.user.id, activeOrder!.id, activeOrder!.version, 'in_preparation');
          await render();
        });
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to print order tickets.';
      }
    });
    orderPanel.append(cart, orderSummary);
    const previousOrders = renderPreviousOrders(sessionOrders, activeOrder, kdsSnapshot);
    if (previousOrders) orderPanel.append(previousOrders);
  }

  const menuPanel = el('section', 'pos-panel menu-panel');
  menuPanel.innerHTML = '<div class="pos-panel-heading"><h3>Menu entry</h3><span>Tap to add to order</span></div>';
  for (const category of menu) {
    const group = el('div', 'menu-category');
    group.append(el('h4', '', category.name));
    const itemGrid = el('div', 'menu-grid');
    for (const item of category.items.filter((row) => row.isAvailable !== false)) {
      const button = el('button', 'menu-item-card');
      button.type = 'button';
      button.innerHTML = `<strong>${item.name}</strong><span>${money(item.price)}</span><small>${item.prepStation ?? 'service'}</small>`;
      button.disabled = !selected?.activeSession;
      button.addEventListener('click', () => void addMenuItemToOrder(selected!.activeSession!.id, item.id, activeOrder));
      itemGrid.append(button);
    }
    group.append(itemGrid);
    menuPanel.append(group);
  }

  workspace.append(floorPanel, orderPanel, menuPanel);
  return section;
}

async function renderBillingDesk(): Promise<HTMLElement> {
  const section = page(canCloseBills() ? 'Cashier billing desk' : 'Bill viewer', canCloseBills() ? 'Cashier-first workspace for preparing checks, payments, receipts, and paid-table closeout.' : 'Waiters can review guest bills, but only the cashier can collect payment or close checks.');
  section.classList.add('pos-page', 'billing-page');

  const status = el('p', 'pos-status');
  status.hidden = true;
  const workspace = el('div', 'pos-workspace billing-workspace');
  section.append(status, workspace);

  const cashierMode = canCloseBills();

  const [floor, orders, kdsSnapshot] = await Promise.all([
    loadCashierTableFloor(session!.user.branchId),
    apiClient.listOrders(),
    apiClient.getKdsSnapshot(undefined, 'all'),
  ]);
  if (!selectedTableId || !floor.tables.some((row) => row.table.id === selectedTableId)) selectedTableId = floor.tables.find((row) => row.activeSession)?.table.id ?? floor.tables[0]?.table.id;
  const selected = floor.tables.find((row) => row.table.id === selectedTableId) ?? floor.tables[0];
  const selectedSessionId = selected?.activeSession?.id;

  const tablePanel = el('section', 'pos-panel table-panel billing-table-panel');
  tablePanel.innerHTML = `<div class="pos-panel-heading"><h3>Open checks</h3><span>${floor.counts.occupied} occupied tables</span></div>`;
  const tableGrid = el('div', 'table-grid billing-table-grid');
  for (const row of floor.tables) {
    const button = el('button', `table-tile ${row.status} ${row.table.id === selected?.table.id ? 'selected' : ''}`);
    button.type = 'button';
    button.innerHTML = `<strong>${row.table.name}</strong><span>${row.status}</span><small>${row.activeSession ? `${money(tableSubtotal(orders, row.activeSession.id))} · ${row.activeSession.guestCount} guests` : 'No open check'}</small>`;
    button.disabled = !row.activeSession;
    button.addEventListener('click', () => {
      selectedTableId = row.table.id;
      render();
    });
    tableGrid.append(button);
  }
  tablePanel.append(tableGrid);

  const billPanel = el('section', 'pos-panel billing-detail-panel');
  if (!selected || !selectedSessionId) {
    billPanel.innerHTML = '<h3>No active bill selected</h3><p class="muted">Choose an occupied table to prepare or collect a bill.</p>';
    workspace.append(tablePanel, billPanel);
    return section;
  }

  const linkedOrders = linkedOrdersForSession(orders, selectedSessionId);
  const itemCount = linkedOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
  let receipt: ReceiptPayload | undefined;
  try {
    receipt = await apiClient.getReceipt(selectedSessionId);
  } catch (caught) {
    if (!(caught instanceof Error) || !/not found|No bill/i.test(caught.message)) {
      status.hidden = false;
      status.textContent = caught instanceof Error ? caught.message : 'Unable to load bill details.';
    }
  }

  billPanel.replaceChildren();
  if (linkedOrders.length && itemCount) billPanel.append(renderOrderedItemsReview(linkedOrders, kdsSnapshot));
  const billHeading = el('div', 'pos-panel-heading');
  billHeading.innerHTML = `<h3>${selected.table.name} bill</h3><span>${selected.activeSession!.guestCount} guests · ${itemCount} items</span>`;
  billPanel.append(billHeading);

  if (!linkedOrders.length || !itemCount) {
    billPanel.append(emptyState('No order items are ready for billing. Add items from Order first.'));
  } else if (!receipt) {
    const draft = el('div', 'billing-draft');
    draft.innerHTML = `
      <div class="bill-total-card"><span>Current order subtotal</span><strong>${money(tableSubtotal(orders, selectedSessionId))}</strong><small>Prepare a bill to lock the current items into cashier review.</small></div>
      <label>Split bill before preparing
        <select name="splitCount">
          <option value="1" ${selectedSplitCount === 1 ? 'selected' : ''}>No split</option>
          <option value="2" ${selectedSplitCount === 2 ? 'selected' : ''}>Split A / B</option>
          <option value="3" ${selectedSplitCount === 3 ? 'selected' : ''}>Split A / B / C</option>
        </select>
      </label>
      <button type="button" class="billing-action" ${cashierMode ? '' : 'disabled'}>${cashierMode ? 'Prepare bill for payment' : 'Cashier prepares bill'}</button>
    `;
    draft.querySelector<HTMLSelectElement>('select')?.addEventListener('change', (event) => {
      selectedSplitCount = Number((event.currentTarget as HTMLSelectElement).value);
      render();
    });
    draft.append(renderSplitItemAssignment(selectedSessionId, orders));
    draft.querySelector<HTMLButtonElement>('.billing-action')?.addEventListener('click', async (event) => {
      try {
        await runButtonAction(event.currentTarget as HTMLButtonElement, { loading: 'Preparing bill…', success: 'Bill is ready for payment.', error: 'Unable to prepare bill.' }, async () => {
          await createBillForSession(selectedSessionId);
          render();
        });
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to prepare bill.';
      }
    });
    billPanel.append(draft);
  } else {
    const summary = el('div', 'billing-summary');
    summary.innerHTML = `
      <div class="bill-total-card"><span>Total due</span><strong>${money(receipt.calculationBreakdown.totalDue)}</strong><small>Paid ${money(receipt.totalPaid)} · Balance ${money(receipt.balanceDue)}</small></div>
      <div class="bill-metrics">
        <div><span>Subtotal</span><strong>${money(receipt.calculationBreakdown.subtotal)}</strong></div>
        <div><span>Discount</span><strong>${money(receipt.calculationBreakdown.discounts.total)}</strong></div>
        <div><span>Tax</span><strong>${money(receipt.calculationBreakdown.taxTotal)}</strong></div>
      </div>
    `;
    billPanel.append(summary);

    const lines = el('div', 'bill-lines');
    lines.append(el('h4', '', 'Bill details'));
    for (const line of receipt.calculationBreakdown.lines) {
      const row = el('div', 'bill-line-row');
      row.innerHTML = `<div><strong>${line.quantity}× ${line.name}</strong><small>${money(line.unitPrice)} each${line.discounts.itemLevel || line.discounts.combo || line.discounts.happyHour ? ` · discounts ${money(line.discounts.itemLevel + line.discounts.combo + line.discounts.happyHour)}` : ''}</small></div><strong>${money(line.lineTotal)}</strong>`;
      lines.append(row);
    }
    billPanel.append(lines);

    const splits = el('div', 'bill-splits');
    splits.append(el('h4', '', 'Split payments'));
    for (const split of receipt.splits.filter((row) => row.lines.length || row.calculationBreakdown.totalDue > 0)) {
      const paid = split.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const balance = Math.round((split.calculationBreakdown.totalDue - paid) * 100) / 100;
      const card = el('article', `bill-split-card ${balance <= 0 ? 'paid' : 'open'}`);
      card.innerHTML = `
        <div><strong>Split ${split.label}</strong>${badge(balance <= 0 ? 'paid' : 'open', balance <= 0 ? 'ready' : 'warning').outerHTML}</div>
        <p>${split.lines.length} lines · Total ${money(split.calculationBreakdown.totalDue)} · Paid ${money(paid)} · Balance ${money(Math.max(balance, 0))}</p>
        <div class="billing-actions">
          <button type="button" class="take-payment" ${balance <= 0 || !cashierMode ? 'disabled' : ''}>${cashierMode ? 'Take cash payment' : 'Cashier payment only'}</button>
          ${receipt.splits.filter((row) => row.lines.length || row.calculationBreakdown.totalDue > 0).length > 1 ? `<button type="button" class="secondary print-split" ${cashierMode ? '' : 'disabled'}>Print Split ${split.label}</button>` : ''}
        </div>
      `;
      card.querySelector<HTMLButtonElement>('.take-payment')?.addEventListener('click', async (event) => {
        try {
          await runButtonAction(event.currentTarget as HTMLButtonElement, { loading: 'Recording cash payment…', success: `Cash payment recorded for Split ${split.label}.`, error: 'Unable to record payment.' }, async () => {
            await apiClient.recordSplitPayment({
              tableSessionId: selectedSessionId,
              splitLabel: split.label,
              amount: Math.max(balance, 0),
              method: 'cash',
              createDebtForUnpaidBalance: false,
            }, session!.user.id, `billing-paid-${selectedSessionId}-${split.label}-${Date.now()}`);
            render();
          });
        } catch (caught) {
          status.hidden = false;
          status.textContent = caught instanceof Error ? caught.message : 'Unable to record payment.';
        }
      });
      card.querySelector<HTMLButtonElement>('.print-split')?.addEventListener('click', () => {
        pendingPrintPreview = { tableSessionId: selectedSessionId, receipt: receipt!, splitLabel: split.label };
        render();
      });
      splits.append(card);
    }
    billPanel.append(splits);

    billPanel.append(renderSplitItemAssignment(selectedSessionId, orders, receipt));

    const billActions = el('div', 'billing-actions');
    billActions.innerHTML = `
      <button type="button" class="secondary back-split">Back</button>
      <button type="button" class="secondary update-splits" ${cashierMode ? '' : 'disabled'}>Update split items</button>
      <button type="button" class="secondary merge-splits" ${cashierMode ? '' : 'disabled'}>Merge splits</button>
      <button type="button" class="secondary tax-toggle" ${cashierMode ? '' : 'disabled'}>${receipt.calculationBreakdown.taxMode === 'taxable' ? 'Mark tax exempt' : 'Enable tax'}</button>
      ${receipt.splits.filter((row) => row.lines.length || row.calculationBreakdown.totalDue > 0).length === 1 ? `<button type="button" class="secondary print-receipt" ${cashierMode ? '' : 'disabled'}>Print receipt</button>` : ''}
      <button type="button" class="billing-action close-table" ${receipt.balanceDue > 0 || !cashierMode ? 'disabled' : ''}>${cashierMode ? 'Close paid table' : 'Cashier closes table'}</button>
    `;
    billActions.querySelector<HTMLButtonElement>('.back-split')?.addEventListener('click', () => { window.history.back(); });
    billActions.querySelector<HTMLButtonElement>('.update-splits')?.addEventListener('click', async (event) => {
      try {
        await runButtonAction(event.currentTarget as HTMLButtonElement, { loading: 'Updating split items…', success: 'Split items updated.', error: 'Unable to update split items.' }, async () => {
          await apiClient.updateBillSplitItems({ tableSessionId: selectedSessionId, itemsBySplit: splitDraftSelections[selectedSessionId] ?? {} }, session!.user.id);
          render();
        });
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to update split items.';
      }
    });
    billActions.querySelector<HTMLButtonElement>('.merge-splits')?.addEventListener('click', async (event) => {
      try {
        await runButtonAction(event.currentTarget as HTMLButtonElement, { loading: 'Merging split bills…', success: 'Split bills merged.', error: 'Unable to merge split bills.' }, async () => {
          await apiClient.mergeBillSplits({ tableSessionId: selectedSessionId, targetSplitLabel: 'A' }, session!.user.id);
          splitDraftSelections[selectedSessionId] = {};
          render();
        });
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to merge split bills.';
      }
    });
    billActions.querySelector<HTMLButtonElement>('.tax-toggle')?.addEventListener('click', async (event) => {
      try {
        await runButtonAction(event.currentTarget as HTMLButtonElement, { loading: 'Updating tax mode…', success: 'Tax mode updated.', error: 'Unable to update tax mode.' }, async () => {
          await apiClient.setBillTaxMode({ tableSessionId: selectedSessionId, taxMode: receipt!.calculationBreakdown.taxMode === 'taxable' ? 'tax_exempt' : 'taxable' }, session!.user.id);
          render();
        });
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to update tax mode.';
      }
    });
    billActions.querySelector<HTMLButtonElement>('.print-receipt')?.addEventListener('click', async (event) => {
      try {
        await runButtonAction(event.currentTarget as HTMLButtonElement, { loading: 'Loading print preview…', success: 'Print preview is ready.', error: 'Unable to load receipt.' }, async () => {
          pendingPrintPreview = { tableSessionId: selectedSessionId, receipt: await apiClient.getReceipt(selectedSessionId) };
          render();
        });
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to print receipt.';
      }
    });
    billActions.querySelector<HTMLButtonElement>('.close-table')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      status.hidden = false;
      status.textContent = 'Closing paid table…';
      try {
        await runButtonAction(button, { loading: 'Closing paid table…', success: 'Paid table closed and returned to available.', error: 'Unable to close table.' }, async () => {
          await advanceSessionOrdersForClose(selectedSessionId);
          await closePaidTableFromBillingScreen({ user: session!.user, tableSessionId: selectedSessionId, branchId: session!.user.branchId });
          selectedTableId = undefined;
          status.textContent = 'Paid table closed and returned to available.';
          render();
        });
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to close table.';
      }
    });
    billPanel.append(billActions);
    if (pendingPrintPreview?.tableSessionId === selectedSessionId) billPanel.append(renderPrintPreview(selectedSessionId, pendingPrintPreview.receipt, pendingPrintPreview.splitLabel));
  }

  workspace.append(tablePanel, billPanel);
  return section;
}


async function renderTableFloor(): Promise<HTMLElement> {
  const section = page('Table floor', 'Tap an available table to open it, or tap an occupied table to continue ordering with that table selected.');
  section.classList.add('pos-page', 'table-floor-page');
  const status = el('p', 'pos-status');
  status.hidden = true;
  const [floor, orders, kdsSnapshot] = await Promise.all([
    loadCashierTableFloor(session!.user.branchId),
    apiClient.listOrders(),
    apiClient.getKdsSnapshot(undefined, 'all'),
  ]);
  const summary = el('section', 'pos-panel table-floor-summary');
  summary.innerHTML = `<div class="pos-panel-heading"><h3>Floor layout</h3><span>${floor.counts.available} available · ${floor.counts.occupied} occupied · ${floor.counts.inactive} inactive</span></div>`;
  const plan = createTableLayoutFlow(floor.tables, {
    editable: false,
    orders,
    kdsSnapshot,
    ariaLabel: 'React Flow table floor layout',
    emptyMessage: 'No tables configured. Create tables from Table layout admin.',
  });
  plan.querySelectorAll<HTMLButtonElement>('.table-layout-node').forEach((button) => {
    const row = floor.tables.find((tableRow) => tableRow.table.id === button.dataset.tableId);
    if (!row) return;
    button.addEventListener('click', async () => {
      if (row.status === 'inactive') {
        status.hidden = false;
        status.textContent = `${row.table.name} is inactive. Reactivate it from Table layout admin before opening orders.`;
        return;
      }
      try {
        if (!row.activeSession) {
          const guestCount = Math.max(1, Math.min(row.table.capacity, 2));
          await apiClient.openTableSession(session!.user.id, row.table.id, guestCount, session!.user.branchId);
        }
        selectedTableId = row.table.id;
        navigate('#/orders');
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to open table.';
      }
    });
  });
  summary.append(plan);
  section.append(status, summary);
  return section;
}

async function renderTableLayoutAdmin(): Promise<HTMLElement> {
  const section = page('Table layout admin', 'Configure the floor plan, create tables, rename them, move them, deactivate them, or remove unused tables.');
  const status = el('p', 'pos-status');
  status.hidden = true;
  const floor = await loadCashierTableFloor(session!.user.branchId);
  const panel = el('section', 'admin-panel table-admin-panel');
  const createCard = el('article', 'card admin-card');
  createCard.innerHTML = `
    <h3>Create table</h3>
    <form class="staff-form table-create-form">
      <label>Name<input name="name" required placeholder="Patio 1" /></label>
      <label>Capacity<input name="capacity" type="number" min="1" value="4" required /></label>
      <label>Layout X %<input name="layoutX" type="number" min="0" max="100" value="10" /></label>
      <label>Layout Y %<input name="layoutY" type="number" min="0" max="100" value="10" /></label>
      <label>Status<select name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <button type="submit">Add to floor</button>
      <p class="form-error" hidden></p>
    </form>
  `;
  panel.append(createCard);

  const layoutCard = el('article', 'card admin-card table-layout-editor');
  layoutCard.innerHTML = '<h3>Floor plan builder</h3><p class="muted">Drag tables on the React Flow canvas to place the floor layout. The X/Y fields below stay in sync for precise adjustments.</p>';
  const layoutPlan = createTableLayoutFlow(floor.tables);
  layoutCard.append(layoutPlan);
  layoutCard.append(el('h4', '', 'Table configuration'));
  if (!floor.tables.length) layoutCard.append(emptyState('No tables yet. Create one to start the layout.'));
  for (const [index, row] of floor.tables.entries()) {
    const form = el('form', 'table-admin-row');
    form.dataset.tableId = row.table.id;
    form.innerHTML = `
      <div><strong>${row.table.name}</strong><small>${row.status}${row.activeSession ? ` · open session ${row.activeSession.id.slice(-8)}` : ''}</small></div>
      <label>Name<input name="name" value="${row.table.name}" required /></label>
      <label>Seats<input name="capacity" type="number" min="1" value="${row.table.capacity}" required /></label>
      <label>X %<input name="layoutX" type="number" min="0" max="100" value="${row.table.layoutX ?? tableLayoutPosition(row, index).left}" /></label>
      <label>Y %<input name="layoutY" type="number" min="0" max="100" value="${row.table.layoutY ?? tableLayoutPosition(row, index).top}" /></label>
      <label>Status<select name="status"><option value="active" ${row.table.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${row.table.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>
      <button type="submit">Save</button>
      <button type="button" class="secondary remove-table">Remove</button>
    `;
    layoutCard.append(form);
  }
  panel.append(layoutCard);
  section.append(status, panel);

  const layoutFormsByTableId = new Map([...layoutCard.querySelectorAll<HTMLFormElement>('.table-admin-row')].map((form) => [form.dataset.tableId, form]));

  function setStatusMessage(message: string): void {
    status.hidden = false;
    status.textContent = message;
  }

  function syncLayoutInputs(tableId: string, layoutX: number, layoutY: number): void {
    const form = layoutFormsByTableId.get(tableId);
    const xInput = form?.querySelector<HTMLInputElement>('input[name="layoutX"]');
    const yInput = form?.querySelector<HTMLInputElement>('input[name="layoutY"]');
    if (xInput) xInput.value = String(layoutX);
    if (yInput) yInput.value = String(layoutY);
  }

  function focusTableConfiguration(tableId: string): void {
    layoutCard.querySelectorAll<HTMLFormElement>('.table-admin-row').forEach((form) => {
      form.classList.toggle('selected', form.dataset.tableId === tableId);
    });
  }

  bindTableLayoutFlow(layoutPlan, {
    onNodeSelect: focusTableConfiguration,
    onNodeMove: syncLayoutInputs,
    onNodeSave: async (tableId, position) => {
      try {
        await apiClient.updateTable(tableId, { layoutX: position.layoutX, layoutY: position.layoutY });
        setStatusMessage('Floor layout saved.');
      } catch (caught) {
        setStatusMessage(caught instanceof Error ? caught.message : 'Unable to save table position.');
        throw caught;
      }
    },
  });

  createCard.querySelector<HTMLFormElement>('.table-create-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    try {
      await apiClient.createTable({
        branchId: session!.user.branchId,
        name: String(data.get('name') ?? ''),
        capacity: Number(data.get('capacity') ?? 1),
        status: String(data.get('status') ?? 'active') as 'active' | 'inactive',
        layoutX: data.get('layoutX') === '' ? undefined : Number(data.get('layoutX')),
        layoutY: data.get('layoutY') === '' ? undefined : Number(data.get('layoutY')),
      });
      render();
    } catch (caught) {
      const error = form.querySelector<HTMLParagraphElement>('.form-error');
      if (error) {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : 'Unable to create table.';
      }
    }
  });

  layoutCard.querySelectorAll<HTMLFormElement>('.table-admin-row').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await apiClient.updateTable(form.dataset.tableId!, {
          name: String(data.get('name') ?? ''),
          capacity: Number(data.get('capacity') ?? 1),
          status: String(data.get('status') ?? 'active') as 'active' | 'inactive',
          layoutX: data.get('layoutX') === '' ? undefined : Number(data.get('layoutX')),
          layoutY: data.get('layoutY') === '' ? undefined : Number(data.get('layoutY')),
        });
        render();
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to update table.';
      }
    });
    form.querySelector<HTMLButtonElement>('.remove-table')?.addEventListener('click', async () => {
      try {
        await apiClient.removeTable(form.dataset.tableId!);
        if (selectedTableId === form.dataset.tableId) selectedTableId = undefined;
        render();
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to remove table.';
      }
    });
  });
  return section;
}

async function renderRestaurantPos(): Promise<HTMLElement> {
  const section = page(APP_NAME, 'Select a table, enter menu items, split a bill, mark paid, and clean the table for the next guest.');
  section.classList.add('pos-page');

  const status = el('p', 'pos-status');
  status.hidden = true;
  const workspace = el('div', 'pos-workspace');
  section.append(status, workspace);

  const [floor, menu, orders, kdsSnapshot] = await Promise.all([
    loadCashierTableFloor(session!.user.branchId),
    apiClient.listMenu() as Promise<MenuCategoryForPos[]>,
    apiClient.listOrders(),
    apiClient.getKdsSnapshot(undefined, 'all'),
  ]);
  if (!selectedTableId) selectedTableId = floor.tables.find((row) => row.status !== 'inactive')?.table.id;
  const selected = floor.tables.find((row) => row.table.id === selectedTableId) ?? floor.tables[0];
  const activeOrder = selected?.activeSession ? findOpenOrder(orders, selected.activeSession.id) : undefined;

  const floorPanel = el('section', 'pos-panel table-panel');
  floorPanel.innerHTML = `<div class="pos-panel-heading"><h3>Table floor</h3><span>${floor.counts.available} available · ${floor.counts.occupied} occupied</span></div>`;
  const tablePlan = el('div', 'floor-plan floor-plan--service');
  floor.tables.forEach((row, index) => {
    const button = el('button', `table-tile floor-table ${row.status} ${row.table.id === selected?.table.id ? 'selected' : ''}`);
    button.type = 'button';
    button.innerHTML = tableTileMarkup(row, orders, typeof kdsSnapshot !== 'undefined' ? kdsSnapshot : undefined);
    positionFloorTable(button, row, index);
    button.addEventListener('click', () => {
      selectedTableId = row.table.id;
      render();
    });
    tablePlan.append(button);
  });
  if (!floor.tables.length) tablePlan.append(emptyState('No tables configured.'));
  floorPanel.append(tablePlan);

  const orderPanel = el('section', 'pos-panel order-panel');
  if (!selected) {
    orderPanel.innerHTML = '<h3>No tables configured</h3><p>Starter data will be seeded at sign-in. Refresh or sign in again if this remains empty.</p>';
  } else if (!selected.activeSession) {
    orderPanel.innerHTML = `<h3>${selected.table.name}</h3><p class="muted">Available table. Open it to start ordering immediately.</p>`;
    const openForm = el('form', 'open-table-form');
    openForm.innerHTML = '<label>Guests<input name="guestCount" type="number" min="1" value="2" /></label><button type="submit">Open table</button>';
    openForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const guestCount = Number(new FormData(openForm).get('guestCount') ?? 1);
      try {
        await apiClient.openTableSession(session!.user.id, selected.table.id, guestCount, session!.user.branchId);
        render();
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to open table.';
      }
    });
    orderPanel.append(openForm);
  } else {
    orderPanel.innerHTML = `<div class="pos-panel-heading"><h3>${selected.table.name} order</h3><span>Occupied · ${selected.activeSession.guestCount} guests</span></div>`;
    const cart = el('div', 'cart-list');
    if (!activeOrder?.items.length) cart.append(el('p', 'muted', 'Tap menu items to start this table order.'));
    for (const item of activeOrder?.items ?? []) {
      const row = el('div', 'cart-row');
      row.innerHTML = `<div><strong>${item.name}</strong><small>${money(item.unitPrice)} each</small></div><div class="quantity-controls"><button type="button" data-delta="-1">−</button><span>${item.quantity}</span><button type="button" data-delta="1">+</button></div><strong>${money(item.lineTotal)}</strong>`;
      row.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => {
        void changeOrderItemQuantity(activeOrder!, item.id, item.quantity + Number(button.dataset.delta));
      }));
      cart.append(row);
    }

    const checkout = el('div', 'checkout-box');
    checkout.innerHTML = `
      <label>Split bill
        <select name="splitCount">
          <option value="1" ${selectedSplitCount === 1 ? 'selected' : ''}>No split</option>
          <option value="2" ${selectedSplitCount === 2 ? 'selected' : ''}>Split A / B</option>
          <option value="3" ${selectedSplitCount === 3 ? 'selected' : ''}>Split A / B / C</option>
        </select>
      </label>
      <div><span>Subtotal</span><strong>${money(activeOrder?.subtotal ?? 0)}</strong></div>
      <button type="button" class="pay-clean">Mark paid & clean table</button>
    `;
    checkout.querySelector<HTMLSelectElement>('select')?.addEventListener('change', (event) => {
      selectedSplitCount = Number((event.currentTarget as HTMLSelectElement).value);
      render();
    });
    checkout.querySelector<HTMLButtonElement>('.pay-clean')?.addEventListener('click', async () => {
      try {
        await payAndCleanTable(selected.activeSession!.id);
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to complete payment and clean table.';
      }
    });
    orderPanel.append(cart, checkout);
  }

  const menuPanel = el('section', 'pos-panel menu-panel');
  menuPanel.innerHTML = '<div class="pos-panel-heading"><h3>Order menu</h3><span>Tap to add</span></div>';
  for (const category of menu) {
    const group = el('div', 'menu-category');
    group.append(el('h4', '', category.name));
    const itemGrid = el('div', 'menu-grid');
    for (const item of category.items.filter((row) => row.isAvailable !== false)) {
      const button = el('button', 'menu-item-card');
      button.type = 'button';
      button.innerHTML = `<strong>${item.name}</strong><span>${money(item.price)}</span><small>${item.prepStation ?? 'service'}</small>`;
      button.disabled = !selected?.activeSession;
      button.addEventListener('click', () => void addMenuItemToOrder(selected!.activeSession!.id, item.id, activeOrder));
      itemGrid.append(button);
    }
    group.append(itemGrid);
    menuPanel.append(group);
  }

  workspace.append(floorPanel, orderPanel, menuPanel);
  return section;
}

async function renderRoute(generation: number): Promise<void> {
  if (!session) return renderLogin();
  await syncApplicationLocale();
  const current = activeRoute();
  let content: HTMLElement;

  switch (current.path) {
    case '#/dashboard':
      content = await renderDashboard();
      break;
    case '#/order-station':
      content = await renderOrderStation();
      break;
    case '#/tables':
      content = await renderTableFloor();
      break;
    case '#/orders':
      content = await renderOrderEntry();
      break;
    case '#/billing':
      content = await renderBillingDesk();
      break;
    case '#/sales-history':
      content = await renderSalesHistory();
      break;
    case '#/kitchen':
      content = await renderKdsStation('kitchen', 'Kitchen');
      break;
    case '#/bar':
      content = await renderKdsStation('bar', 'Bar');
      break;
    case '#/prep-stations':
      content = await renderPrepStations();
      break;
    case '#/waiter-progress':
      content = await renderWaiterProgress();
      break;
    case '#/menu-admin':
      content = await renderMenuAdmin();
      break;
    case '#/table-admin':
      content = await renderTableLayoutAdmin();
      break;
    case '#/inventory-alerts':
      content = await renderInventoryAlerts();
      break;
    case '#/reports':
      renderShell(page('Reports', 'Loading report data…'));
      content = await renderReports();
      break;
    case '#/audit':
      content = await renderAudit();
      break;
    case '#/superadmin':
      content = await renderStaffSettings(true);
      break;
    case '#/localization':
      content = await renderLocalizationSettings();
      break;
    case '#/bill-settings':
      content = await renderBillSettings();
      break;
    case '#/cloud-sync-settings':
      content = await renderCloudSyncSettings();
      break;
    case '#/staff-settings':
      content = await renderStaffSettings();
      break;
    default:
      content = page(translateUiText(current.label), translateUiText('Route shell ready for production workflows.'));
  }

  // API-backed renders can overlap (for example, an item-add refresh may still
  // be loading when the waiter submits the order). Never let an older response
  // replace the newer submitted-order view with its stale pending-order cart.
  if (generation !== renderGeneration) return;
  renderShell(content);
  localizeElementText(root);
}

function render(): Promise<void> {
  const generation = ++renderGeneration;
  return renderRoute(generation).catch((caught) => {
    if (generation !== renderGeneration) return;
    if (caught instanceof ApiClientError && caught.status === 401) {
      session = null;
      loginNotice = 'Your session has expired. Please sign in again.';
      void logout().finally(() => renderLogin(loginNotice));
      return;
    }

    if (route.split('?')[0] === '#/reports') {
      const failed = page('Reports unavailable', 'The report data could not be loaded. Check your permissions or connection, then try again.');
      const detail = el('p', 'pos-status report-failure', caught instanceof Error ? caught.message : 'Unknown report error.');
      const retry = el('button', 'secondary-button', 'Retry');
      retry.addEventListener('click', () => void render());
      failed.append(detail, retry);
      renderShell(failed);
      return;
    }
    throw caught;
  });
}

render();
