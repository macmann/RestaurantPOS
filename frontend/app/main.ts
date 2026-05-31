import { getStoredSession, login, logout, type BrowserSession } from '../auth/session';
import { appRoutes, canAccessRoute, defaultRoute, visibleRoutes, type AppRoute } from '../auth/navigation';
import type { AuthenticatedUser } from '../../backend/auth/policies';
import { RolePermissions } from '../../backend/auth/permissions';
import { loadKitchenQueue, setKitchenItemProgress } from '../kds/kitchen-screen';
import { loadBarQueue, setBarItemProgress } from '../kds/bar-screen';
import { loadOrderProgressForWaiter } from '../waiter/order-progress';
import { loadAdminMenuDashboard } from '../admin/menu-management';
import { loadAdminAuditViewer } from '../admin/audit-viewer';
import { ApiClientError, apiClient } from '../api/client';
import { loadCashierTableFloor } from '../cashier/table-floor';
import type { OrderRecord, OrderStatus } from '../../backend/orders/repository';
import type { SplitLabel, TableOrderItem } from '../../backend/billing/repository';

const APP_NAME = 'SYM POS';

const rootElement = document.querySelector<HTMLDivElement>('#app');
if (!rootElement) throw new Error('App root not found.');
const root = rootElement;

let session: BrowserSession | null = getStoredSession();
let route = window.location.hash || defaultRoute(session?.permissions ?? []).path;
let apiStatus = apiClient.getNetworkStatus();
let apiStatusMessage = 'API connection healthy.';
let loginNotice: string | undefined;
let healthTimer: number | undefined;
let selectedTableId: string | undefined;
let selectedSplitCount = 1;

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
  route = window.location.hash || defaultRoute(session?.permissions ?? []).path;
  render();
});

function navigate(path: string): void {
  if (window.location.hash === path) render();
  else window.location.hash = path;
}

function activeRoute(): AppRoute {
  return appRoutes.find((item) => item.path === route) ?? defaultRoute(session?.permissions ?? []);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
  const card = el('form', 'login-card');
  card.innerHTML = `
    <div class="brand-heading">${brandLogo('brand-logo--large')}<p class="eyebrow">${APP_NAME}</p></div>
    <h1>Sign in to ${APP_NAME}</h1>
    <p>Enter your staff username or email and password. The browser stores only a revocable session token.</p>
    <label>Username or email<input name="identifier" autocomplete="username" placeholder="manager-1" required /></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
    <button type="submit">Start secure session</button>
    <p class="form-error" ${message ? '' : 'hidden'}>${message ?? ''}</p>
  `;
  card.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(card);
    const input = form.get('identifier');
    const password = form.get('password');
    const error = card.querySelector<HTMLParagraphElement>('.form-error');
    try {
      session = await login(String(input ?? ''), String(password ?? ''));
      loginNotice = undefined;
      navigate(defaultRoute(session.permissions).path);
    } catch (caught) {
      if (error) {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : 'Unable to sign in.';
      }
    }
  });
  shell.append(card);
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

function renderShell(content: HTMLElement): void {
  if (!session) return renderLogin();

  const available = visibleRoutes(session.permissions);
  const current = activeRoute();
  if (!canAccessRoute(current, session.permissions)) {
    navigate(defaultRoute(session.permissions).path);
    return;
  }

  const layout = el('div', 'app-shell');
  const sidebar = el('aside', 'sidebar');
  const roleLabel = Array.isArray(session.user.role) ? session.user.role.join(', ') : session.user.role;
  sidebar.innerHTML = `
    <div class="sidebar-brand">${brandLogo()}<div><h1>${APP_NAME}</h1><span>Restaurant command center</span></div></div>
    <p class="sidebar-user">${session.user.id} · ${roleLabel}</p>
  `;

  const mobileNav = el('div', 'mobile-route-bar');
  mobileNav.innerHTML = `
    <div class="mobile-route-brand">${brandLogo()}<div><strong>${APP_NAME}</strong><span>${current.label}</span></div></div>
  `;
  const routeSelect = el('select');
  routeSelect.setAttribute('aria-label', 'Switch POS section');
  for (const item of available) {
    const option = el('option', '', item.label);
    option.value = item.path;
    option.selected = item.path === current.path;
    routeSelect.append(option);
  }
  routeSelect.addEventListener('change', () => navigate(routeSelect.value));
  mobileNav.append(routeSelect);

  for (const section of ['operations', 'admin'] as const) {
    const groupRoutes = available.filter((item) => item.section === section);
    if (!groupRoutes.length) continue;
    const heading = el('h2', '', section === 'operations' ? 'Operations' : 'Administration');
    const nav = el('nav');
    for (const item of groupRoutes) {
      const link = el('a', item.path === current.path ? 'active' : '', item.label);
      link.href = item.path;
      nav.append(link);
    }
    sidebar.append(heading, nav);
  }

  const signOut = el('button', 'secondary', 'Sign out');
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
  main.append(mobileNav, banner, content);
  startHealthChecks();
  layout.append(sidebar, main);
  root.replaceChildren(layout);
}

function page(title: string, subtitle: string, actions: string[] = []): HTMLElement {
  const section = el('section', 'page');
  const header = el('header', 'page-header');
  header.innerHTML = `<p class="eyebrow">${APP_NAME} client</p><h2>${title}</h2><p>${subtitle}</p>`;
  const grid = el('div', 'card-grid');
  for (const action of actions) {
    const card = el('article', 'card');
    card.innerHTML = `<h3>${action}</h3><p>Connected through the shared API client and current session.</p>`;
    grid.append(card);
  }
  section.append(header, grid);
  return section;
}


const assignableRoles = Object.keys(RolePermissions);

function roleOptions(selectedRole?: string): string {
  return assignableRoles.map((role) => `<option value="${role}" ${role === selectedRole ? 'selected' : ''}>${role}</option>`).join('');
}

function rolesFor(user: AuthenticatedUser): string {
  return Array.isArray(user.role) ? user.role.join(',') : user.role;
}

async function renderStaffSettings(isSuperadminPanel = false): Promise<HTMLElement> {
  const section = page(
    isSuperadminPanel ? 'Super admin account panel' : 'Staff & settings administration',
    isSuperadminPanel
      ? 'Use the seeded superadmin account to create staff users and assign each account to the correct role.'
      : 'Create staff profiles, rotate passwords, assign roles, and deactivate access immediately.',
    ['Staff users', 'Role assignment', 'Activation', 'Branch settings'],
  );
  const panel = el('section', 'admin-panel');
  const [users, settings] = await Promise.all([apiClient.listUsers(), apiClient.getSettings()]);
  panel.innerHTML = `
    <article class="card admin-card">
      <h3>${isSuperadminPanel ? 'Create role-based account' : 'Create staff profile'}</h3>
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
    <article class="card admin-card">
      <h3>Runtime settings</h3>
      <pre class="json-preview compact">${JSON.stringify(settings, null, 2)}</pre>
    </article>
  `;

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
  panel.append(table);
  section.append(panel);

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

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

async function renderKdsStation(station: 'kitchen' | 'bar'): Promise<HTMLElement> {
  const title = station === 'kitchen' ? 'Kitchen KDS' : 'Bar KDS';
  const section = page(title, `${title} tickets are grouped by station with action buttons for prep progress.`);
  const state = station === 'kitchen' ? await loadKitchenQueue() : await loadBarQueue();
  const group = state.queue.groups.find((row) => row.station === station);
  const board = el('div', 'kds-board');
  const items = group?.items ?? [];
  if (!items.length) board.append(emptyState(`No ${station} tickets are waiting.`));
  for (const item of items) {
    const ticket = el('article', `kds-ticket ${item.progress}`);
    ticket.innerHTML = `
      <div class="ticket-head"><strong>${item.quantity}× ${item.itemName}</strong><span>${formatElapsed(item.elapsedSeconds)}</span></div>
      <p>Order ${item.orderId.slice(-8)}${item.note ? ` · ${item.note}` : ''}</p>
      <div class="ticket-actions"></div>
    `;
    ticket.querySelector('.ticket-head')?.append(badge(item.progress, item.progress));
    const actions = ticket.querySelector<HTMLElement>('.ticket-actions')!;
    for (const next of ['preparing', 'ready'] as const) {
      const button = el('button', next === item.progress ? 'secondary' : '', next === 'preparing' ? 'Start prep' : 'Mark ready');
      button.type = 'button';
      button.disabled = item.progress === next || item.progress === 'served';
      button.addEventListener('click', async () => {
        if (station === 'kitchen') await setKitchenItemProgress(session!.user, item.orderId, item.orderItemId, next);
        else await setBarItemProgress(session!.user, item.orderId, item.orderItemId, next);
        render();
      });
      actions.append(button);
    }
    board.append(ticket);
  }
  section.append(board);
  return section;
}

async function renderWaiterProgress(): Promise<HTMLElement> {
  const section = page('Waiter progress', 'Track kitchen and bar readiness for orders before updating guests.');
  const state = await loadOrderProgressForWaiter();
  const lanes = el('div', 'progress-lanes');
  for (const group of state.snapshot.groups) {
    const lane = el('section', 'progress-lane');
    lane.append(el('h3', '', group.station === 'kitchen' ? 'Kitchen' : 'Bar'));
    if (!group.items.length) lane.append(emptyState('No active items.'));
    for (const item of group.items) {
      const row = el('div', 'progress-row');
      row.innerHTML = `<strong>${item.quantity}× ${item.itemName}</strong><small>Order ${item.orderId.slice(-8)} · ${formatElapsed(item.elapsedSeconds)}</small>`;
      row.append(badge(item.progress, item.progress));
      lane.append(row);
    }
    lanes.append(lane);
  }
  section.append(lanes);
  return section;
}

async function renderMenuAdmin(): Promise<HTMLElement> {
  const section = page('Menu admin', 'Create items, route them to kitchen or bar, toggle availability, and flag promotions.');
  const state = await loadAdminMenuDashboard();
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
        <label>Category<select name="categoryId">${categories.map((cat) => `<option value="${cat.id}">${cat.name}</option>`).join('')}</select></label>
        <label>Name<input name="name" required placeholder="Tea leaf salad" /></label>
        <label>Price<input name="price" type="number" min="0" step="0.01" required /></label>
        <label>Station<select name="prepStation"><option value="kitchen">Kitchen</option><option value="bar">Bar</option></select></label>
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
      row.innerHTML = `<div><strong>${item.name}</strong><small>${money(item.price)} · ${item.prepStation ?? 'service'}${item.description ? ` · ${item.description}` : ''}</small></div>`;
      row.append(badge(item.isAvailable ? 'available' : 'hidden', item.isAvailable ? 'ready' : 'queued'));
      row.append(badge(item.isPromotional ? 'promo' : 'regular'));
      const availability = el('button', 'secondary', item.isAvailable ? 'Hide' : 'Show');
      availability.addEventListener('click', async () => { await apiClient.setMenuItemAvailability(item.id, !item.isAvailable); render(); });
      const promo = el('button', 'secondary', item.isPromotional ? 'Remove promo' : 'Make promo');
      promo.addEventListener('click', async () => { await apiClient.setMenuItemPromotional(item.id, !item.isPromotional); render(); });
      row.append(availability, promo);
      card.append(row);
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
      prepStation: String(data.get('prepStation') ?? 'kitchen') as 'kitchen' | 'bar',
    });
    render();
  });
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

async function renderReports(): Promise<HTMLElement> {
  const section = page('Reports', 'Review sales, inventory usage, and financial summary without reading raw API payloads.');
  const [sales, inventory, financial] = await Promise.all([apiClient.getSalesReport('day') as Promise<any>, apiClient.getInventoryUsageReport(), apiClient.getFinancialSummaryReport()]);
  const cards = el('div', 'report-grid');
  const salesCard = el('article', 'card report-card');
  salesCard.innerHTML = `<h3>Daily sales</h3><p><strong>${money(sales.summary?.revenue ?? 0)}</strong> revenue · ${sales.summary?.orderCount ?? 0} orders</p>`;
  const salesRows = el('div', 'report-rows');
  for (const row of sales.rows ?? []) salesRows.append(el('p', '', `${row.periodLabel}: ${money(row.revenue)} across ${row.orderCount} orders`));
  salesCard.append(salesRows);
  const invCard = el('article', 'card report-card');
  invCard.innerHTML = `<h3>Inventory usage</h3><p>${inventory.summary.itemCount} items · ${inventory.summary.totalUsed} used · ${inventory.summary.totalWastage} wastage</p>`;
  const finCard = el('article', 'card report-card');
  finCard.innerHTML = `<h3>Financial summary</h3><p>${money(financial.summary.revenue)} revenue · ${money(financial.summary.grossProfit)} gross profit · ${financial.summary.grossMarginPercent}% margin</p>`;
  cards.append(salesCard, invCard, finCard);
  section.append(cards);
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
    await apiClient.editOrder(session.user.id, activeOrder.id, {
      expectedVersion: activeOrder.version,
      addItems: [{ menuItemId, quantity: 1 }],
      reason: 'POS quick add',
    });
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

async function renderRestaurantPos(): Promise<HTMLElement> {
  const section = page(APP_NAME, 'Select a table, enter menu items, split a bill, mark paid, and clean the table for the next guest.');
  section.classList.add('pos-page');

  const status = el('p', 'pos-status');
  status.hidden = true;
  const workspace = el('div', 'pos-workspace');
  section.append(status, workspace);

  const [floor, menu, orders] = await Promise.all([
    loadCashierTableFloor(session!.user.branchId),
    apiClient.listMenu() as Promise<MenuCategoryForPos[]>,
    apiClient.listOrders(),
  ]);
  if (!selectedTableId) selectedTableId = floor.tables.find((row) => row.status !== 'inactive')?.table.id;
  const selected = floor.tables.find((row) => row.table.id === selectedTableId) ?? floor.tables[0];
  const activeOrder = selected?.activeSession ? findOpenOrder(orders, selected.activeSession.id) : undefined;

  const floorPanel = el('section', 'pos-panel table-panel');
  floorPanel.innerHTML = `<div class="pos-panel-heading"><h3>Table floor</h3><span>${floor.counts.available} available · ${floor.counts.occupied} occupied</span></div>`;
  const tableGrid = el('div', 'table-grid');
  for (const row of floor.tables) {
    const button = el('button', `table-tile ${row.status} ${row.table.id === selected?.table.id ? 'selected' : ''}`);
    button.type = 'button';
    button.innerHTML = `<strong>${row.table.name}</strong><span>${row.status}</span><small>${row.activeSession ? `${row.activeSession.guestCount} guests` : `${row.table.capacity} seats`}</small>`;
    button.addEventListener('click', () => {
      selectedTableId = row.table.id;
      render();
    });
    tableGrid.append(button);
  }
  floorPanel.append(tableGrid);

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

async function renderRoute(): Promise<void> {
  if (!session) return renderLogin();
  const current = activeRoute();
  let content: HTMLElement;

  switch (current.path) {
    case '#/tables':
    case '#/orders':
    case '#/billing':
      content = await renderRestaurantPos();
      break;
    case '#/kitchen':
      content = await renderKdsStation('kitchen');
      break;
    case '#/bar':
      content = await renderKdsStation('bar');
      break;
    case '#/waiter-progress':
      content = await renderWaiterProgress();
      break;
    case '#/menu-admin':
      content = await renderMenuAdmin();
      break;
    case '#/inventory-alerts':
      content = await renderInventoryAlerts();
      break;
    case '#/reports':
      content = await renderReports();
      break;
    case '#/audit':
      content = await renderAudit();
      break;
    case '#/superadmin':
      content = await renderStaffSettings(true);
      break;
    case '#/staff-settings':
      content = await renderStaffSettings();
      break;
    default:
      content = page(current.label, 'Route shell ready for production workflows.');
  }

  renderShell(content);
}

function render(): void {
  void renderRoute().catch((caught) => {
    if (caught instanceof ApiClientError && caught.status === 401) {
      session = null;
      loginNotice = 'Your session has expired. Please sign in again.';
      void logout().finally(() => renderLogin(loginNotice));
      return;
    }

    throw caught;
  });
}

render();
