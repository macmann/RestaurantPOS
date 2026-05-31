import { getStoredSession, login, logout, type BrowserSession } from '../auth/session';
import { appRoutes, canAccessRoute, defaultRoute, visibleRoutes, type AppRoute } from '../auth/navigation';
import type { AuthenticatedUser } from '../../backend/auth/policies';
import { Actions, RolePermissions } from '../../backend/auth/permissions';
import { loadKitchenQueue, setKitchenItemProgress } from '../kds/kitchen-screen';
import { loadBarQueue, setBarItemProgress } from '../kds/bar-screen';
import { loadOrderProgressForWaiter } from '../waiter/order-progress';
import { loadAdminMenuDashboard } from '../admin/menu-management';
import { loadAdminAuditViewer } from '../admin/audit-viewer';
import { ApiClientError, apiClient } from '../api/client';
import { loadCashierTableFloor } from '../cashier/table-floor';
import type { OrderRecord, OrderStatus } from '../../backend/orders/repository';
import type { KdsSnapshot } from '../../backend/kds/service';
import type { TableFloorState } from '../../backend/tables/service';
import type { ReceiptPayload, SplitLabel, TableOrderItem } from '../../backend/billing/repository';

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

function canCloseBills(): boolean {
  return !!session?.permissions.includes(Actions.CloseBill);
}

async function renderStaffSettings(isSuperadminPanel = false): Promise<HTMLElement> {
  const section = page(
    isSuperadminPanel ? 'Superadmin command center' : 'Staff & settings administration',
    isSuperadminPanel
      ? 'Role-based launchpad for users, bill identity, printer routing, menus, tables, reports, and audit controls.'
      : 'Create staff profiles, rotate passwords, assign roles, and deactivate access immediately.',
    isSuperadminPanel ? ['Role-specific POS views', 'Bill identity', 'Printer routing', 'Operations configuration'] : ['Staff users', 'Role assignment', 'Activation', 'Branch settings'],
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

  if (isSuperadminPanel) {
    const launchpad = el('section', 'admin-launchpad');
    launchpad.innerHTML = `
      <button type="button" data-target="#/bill-settings">Bill & printer setup</button>
      <button type="button" data-target="#/menu-admin">Menu setup</button>
      <button type="button" data-target="#/table-admin">Table layout</button>
      <button type="button" data-target="#/reports">Reports</button>
    `;
    launchpad.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.target!)));
    section.append(launchpad);
  }

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
  const section = page(title, `${title} tickets are grouped by active prep tickets and ready history.`);
  const activeTab = new URLSearchParams(route.split('?')[1] ?? '').get('tab') === 'history' ? 'history' : 'active';
  const state = station === 'kitchen' ? await loadKitchenQueue() : await loadBarQueue();
  const queue = activeTab === 'history' ? state.history : state.queue;
  const group = queue.groups.find((row) => row.station === station);
  const board = el('div', 'kds-board');
  const items = group?.items ?? [];
  const tabs = el('div', 'sales-history-tabs kds-tabs');
  tabs.innerHTML = `
    <button type="button" class="${activeTab === 'active' ? 'active' : ''}" data-tab="active">Active orders</button>
    <button type="button" class="${activeTab === 'history' ? 'active' : ''}" data-tab="history">History</button>
  `;
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => {
    navigate(`${routePath()}?tab=${button.dataset.tab}`);
  }));

  if (!items.length) board.append(emptyState(activeTab === 'history' ? `No ${station} tickets are ready yet.` : `No active ${station} tickets are waiting.`));
  for (const item of items) {
    const ticket = el('article', `kds-ticket ${item.progress}`);
    ticket.innerHTML = `
      <div class="ticket-head"><strong>${item.quantity}× ${item.itemName}</strong><span>${formatElapsed(item.elapsedSeconds)}</span></div>
      <p>Order ${item.orderId.slice(-8)}${item.note ? ` · ${item.note}` : ''}</p>
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
          if (station === 'kitchen') await setKitchenItemProgress(session!.user, item.orderId, item.orderItemId, next);
          else await setBarItemProgress(session!.user, item.orderId, item.orderItemId, next);
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


async function renderBillSettings(): Promise<HTMLElement> {
  const section = page('Bill & printer settings', 'Configure restaurant details printed on receipts and route order/receipt tickets to the correct devices.', ['Receipt header', 'Receipt printer', 'Kitchen printer', 'Bar printer']);
  const settings = await apiClient.getSettings() as any;
  const pos = settings.pos ?? {};
  const info = pos.restaurantBillInfo ?? {};
  const printers = pos.printers ?? {};
  const panel = el('section', 'admin-panel bill-settings-panel');
  const form = el('form', 'staff-form bill-settings-form');
  form.innerHTML = `
    <article class="card admin-card settings-card">
      <h3>Restaurant bill information</h3>
      <label>Restaurant name<input name="restaurantName" value="${info.restaurantName ?? ''}" required /></label>
      <label>Address<textarea name="address" rows="3" required>${info.address ?? ''}</textarea></label>
      <label>Contact<input name="contact" value="${info.contact ?? ''}" required /></label>
      <label>Tax / registration ID<input name="taxId" value="${info.taxId ?? ''}" /></label>
      <label>Receipt footer<input name="receiptFooter" value="${info.receiptFooter ?? ''}" /></label>
    </article>
    ${(['receipt', 'kitchen', 'bar'] as const).map((key) => `
      <article class="card admin-card settings-card">
        <h3>${key === 'receipt' ? 'Receipt printer' : key === 'kitchen' ? 'Kitchen order printer' : 'Bar order printer'}</h3>
        <label class="checkbox-row"><input type="checkbox" name="${key}Enabled" ${(printers[key]?.enabled ?? true) ? 'checked' : ''} /> Enabled</label>
        <label>Printer ID<input name="${key}PrinterId" value="${printers[key]?.printerId ?? ''}" required /></label>
        <label>Display name<input name="${key}DisplayName" value="${printers[key]?.displayName ?? ''}" required /></label>
      </article>
    `).join('')}
    <button type="submit">Save bill & printer settings</button>
    <p class="form-error" hidden></p>
  `;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const printerInput = (key: 'receipt' | 'kitchen' | 'bar') => ({
      enabled: data.get(`${key}Enabled`) === 'on',
      printerId: String(data.get(`${key}PrinterId`) ?? ''),
      displayName: String(data.get(`${key}DisplayName`) ?? ''),
    });
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
          printers: { receipt: printerInput('receipt'), kitchen: printerInput('kitchen'), bar: printerInput('bar') },
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
  const preview = el('article', 'card admin-card receipt-preview-card');
  preview.innerHTML = `<h3>Receipt preview header</h3><p><strong>${info.restaurantName ?? 'Restaurant name'}</strong><br>${info.address ?? 'Address'}<br>${info.contact ?? 'Contact'}</p><small>${info.receiptFooter ?? ''}</small>`;
  panel.append(form, preview);
  section.append(panel);
  return section;
}


type SalesHistoryPeriod = 'day' | 'week' | 'month';
type SalesHistoryTab = 'list' | 'summary';

function isoDateOnly(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function dateRangeForPreset(preset: SalesHistoryPeriod | 'range'): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  if (preset === 'week') start.setUTCDate(start.getUTCDate() - 6);
  if (preset === 'month') start.setUTCMonth(start.getUTCMonth() - 1);
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
  const activeTab = params.get('tab') === 'summary' ? 'summary' : 'list';
  const preset = (params.get('preset') === 'week' || params.get('preset') === 'month' || params.get('preset') === 'range' ? params.get('preset') : 'day') as SalesHistoryPeriod | 'range';
  const presetRange = dateRangeForPreset(preset);
  const dateFromInput = params.get('dateFrom') ?? (preset !== 'range' && presetRange.dateFrom ? presetRange.dateFrom.slice(0, 10) : isoDateOnly());
  const dateToInput = params.get('dateTo') ?? (preset !== 'range' && presetRange.dateTo ? presetRange.dateTo.slice(0, 10) : isoDateOnly());
  const dateFrom = startOfDateInput(dateFromInput) ?? presetRange.dateFrom;
  const dateTo = endOfDateInput(dateToInput) ?? presetRange.dateTo;

  const section = page('Sales history', 'Filter completed sales by day, week, month, or a custom date range. Cashiers and admins can review the list view and the summary tab.');
  const panel = el('section', 'admin-panel sales-history-panel');
  const form = el('form', 'staff-form sales-history-filter');
  form.innerHTML = `
    <label>Quick filter
      <select name="preset">
        <option value="day" ${preset === 'day' ? 'selected' : ''}>Today</option>
        <option value="week" ${preset === 'week' ? 'selected' : ''}>Last 7 days</option>
        <option value="month" ${preset === 'month' ? 'selected' : ''}>Last month</option>
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
    <button type="button" class="${activeTab === 'list' ? 'active' : ''}" data-tab="list">List view</button>
    <button type="button" class="${activeTab === 'summary' ? 'active' : ''}" data-tab="summary">Summary</button>
  `;

  const body = el('div', 'sales-history-body');
  try {
    const report = await apiClient.getSalesReport(period, { dateFrom, dateTo, branchId: session?.user.branchId });
    const rows = report.rows ?? [];
    const itemRows = rows.flatMap((row: any) => (row.items ?? []).map((item: any) => ({ ...item, periodLabel: row.periodLabel })));

    if (activeTab === 'summary') {
      const topItems = [...itemRows].sort((a, b) => (b.grossSales ?? 0) - (a.grossSales ?? 0)).slice(0, 5);
      const summary = el('div', 'report-grid sales-summary-grid');
      summary.innerHTML = `
        <article class="card report-card"><h3>Total revenue</h3><p><strong>${money(report.summary?.revenue ?? 0)}</strong></p></article>
        <article class="card report-card"><h3>Orders</h3><p><strong>${report.summary?.orderCount ?? 0}</strong> orders</p></article>
        <article class="card report-card"><h3>Quantity sold</h3><p><strong>${report.summary?.quantitySold ?? 0}</strong> items</p></article>
      `;
      const topCard = el('article', 'card report-card sales-history-wide');
      topCard.innerHTML = `<h3>Top items</h3>${topItems.length ? `<ol>${topItems.map((item) => `<li><strong>${item.itemName}</strong> — ${item.quantitySold} sold · ${money(item.grossSales)}</li>`).join('')}</ol>` : '<p class="muted">No sales in this range.</p>'}`;
      summary.append(topCard);
      body.append(summary);
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
    next.set('preset', String(data.get('preset') ?? 'day'));
    next.set('period', String(data.get('period') ?? 'day'));
    next.set('tab', activeTab);
    next.set('dateFrom', String(data.get('dateFrom') ?? ''));
    next.set('dateTo', String(data.get('dateTo') ?? ''));
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

function renderOrderedItemsReview(orders: OrderRecord[]): HTMLElement {
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
      const itemMeta = [`${money(item.unitPrice)} each`, `Order ${order.id.slice(-8)}`, order.status.replace(/_/g, ' ')];
      if (item.note) itemMeta.push(item.note);
      detail.append(el('small', '', itemMeta.join(' · ')));
      row.append(detail, el('strong', '', money(item.lineTotal)));
      list.append(row);
    }
  }
  review.append(list);
  return review;
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
    itemsBySplit: orderItemsForBill(orders, tableSessionId, selectedSplitCount),
    pricing: { taxMode: 'taxable', taxRate: 0 },
  }, session.user.id);
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
  const activeOrder = selected?.activeSession ? findOpenOrder(orders, selected.activeSession.id) : undefined;

  const floorPanel = el('section', 'pos-panel table-panel');
  floorPanel.innerHTML = `<div class="pos-panel-heading"><h3>Tables for ordering</h3><span>${floor.counts.available} available · ${floor.counts.occupied} occupied</span></div>`;
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
    const cart = el('div', 'cart-list');
    if (!activeOrder?.items.length) cart.append(el('p', 'muted', 'Tap menu items to start this table order.'));
    const orderStatus = activeOrder?.status.replace(/_/g, ' ') ?? 'new';
    for (const item of activeOrder?.items ?? []) {
      const row = el('div', 'cart-row');
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
      <p class="muted">Save sends kitchen/bar tickets to configured station printers. Billing and table closing stay with the cashier.</p>
    `;
    orderSummary.querySelector<HTMLButtonElement>('.save-order')?.addEventListener('click', async () => {
      try {
        await apiClient.printOrderTickets(session!.user.id, activeOrder!.id);
        status.hidden = false;
        status.textContent = 'Order saved and sent to station printers.';
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to print order tickets.';
      }
    });
    orderPanel.append(cart, orderSummary);
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

  const [floor, orders] = await Promise.all([
    loadCashierTableFloor(session!.user.branchId),
    apiClient.listOrders(),
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
  if (linkedOrders.length && itemCount) billPanel.append(renderOrderedItemsReview(linkedOrders));
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
    draft.querySelector<HTMLButtonElement>('.billing-action')?.addEventListener('click', async () => {
      try {
        await createBillForSession(selectedSessionId);
        render();
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
        <button type="button" ${balance <= 0 || !cashierMode ? 'disabled' : ''}>${cashierMode ? 'Take cash payment' : 'Cashier payment only'}</button>
      `;
      card.querySelector<HTMLButtonElement>('button')?.addEventListener('click', async () => {
        try {
          await apiClient.recordSplitPayment({
            tableSessionId: selectedSessionId,
            splitLabel: split.label,
            amount: Math.max(balance, 0),
            method: 'cash',
            createDebtForUnpaidBalance: false,
          }, session!.user.id, `billing-paid-${selectedSessionId}-${split.label}-${Date.now()}`);
          render();
        } catch (caught) {
          status.hidden = false;
          status.textContent = caught instanceof Error ? caught.message : 'Unable to record payment.';
        }
      });
      splits.append(card);
    }
    billPanel.append(splits);

    const billActions = el('div', 'billing-actions');
    billActions.innerHTML = `
      <button type="button" class="secondary tax-toggle" ${cashierMode ? '' : 'disabled'}>${receipt.calculationBreakdown.taxMode === 'taxable' ? 'Mark tax exempt' : 'Enable tax'}</button>
      <button type="button" class="secondary print-receipt" ${cashierMode ? '' : 'disabled'}>Print receipt</button>
      <button type="button" class="billing-action close-table" ${receipt.balanceDue > 0 || !cashierMode ? 'disabled' : ''}>${cashierMode ? 'Close paid table' : 'Cashier closes table'}</button>
    `;
    billActions.querySelector<HTMLButtonElement>('.tax-toggle')?.addEventListener('click', async () => {
      try {
        await apiClient.setBillTaxMode({ tableSessionId: selectedSessionId, taxMode: receipt!.calculationBreakdown.taxMode === 'taxable' ? 'tax_exempt' : 'taxable', taxRate: 0 }, session!.user.id);
        render();
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to update tax mode.';
      }
    });
    billActions.querySelector<HTMLButtonElement>('.print-receipt')?.addEventListener('click', async () => {
      try {
        await apiClient.printReceipt(selectedSessionId, { copies: 1 }, session!.user.id);
        status.hidden = false;
        status.textContent = 'Receipt sent to configured receipt printer.';
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to print receipt.';
      }
    });
    billActions.querySelector<HTMLButtonElement>('.close-table')?.addEventListener('click', async () => {
      try {
        await advanceSessionOrdersForClose(selectedSessionId);
        await apiClient.closeTableSession(session!.user.id, selectedSessionId);
        selectedTableId = undefined;
        render();
      } catch (caught) {
        status.hidden = false;
        status.textContent = caught instanceof Error ? caught.message : 'Unable to close table.';
      }
    });
    billPanel.append(billActions);
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

async function renderRoute(): Promise<void> {
  if (!session) return renderLogin();
  const current = activeRoute();
  let content: HTMLElement;

  switch (current.path) {
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
    case '#/table-admin':
      content = await renderTableLayoutAdmin();
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
    case '#/bill-settings':
      content = await renderBillSettings();
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
