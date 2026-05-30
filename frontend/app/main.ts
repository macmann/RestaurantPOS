import { getStoredSession, login, logout, type BrowserSession } from '../auth/session';
import { appRoutes, canAccessRoute, defaultRoute, visibleRoutes, type AppRoute } from '../auth/navigation';
import type { AuthenticatedUser } from '../../backend/auth/policies';
import { RolePermissions } from '../../backend/auth/permissions';
import { loadKitchenQueue } from '../kds/kitchen-screen';
import { loadBarQueue } from '../kds/bar-screen';
import { loadOrderProgressForWaiter } from '../waiter/order-progress';
import { loadAdminMenuDashboard } from '../admin/menu-management';
import { loadAdminInventoryAlerts } from '../admin/inventory-alerts';
import { loadAdminAuditViewer } from '../admin/audit-viewer';
import { apiClient } from '../api/client';
import { loadCashierTableFloor } from '../cashier/table-floor';
import type { OrderRecord, OrderStatus } from '../../backend/orders/repository';
import type { SplitLabel, TableOrderItem } from '../../backend/billing/repository';

const rootElement = document.querySelector<HTMLDivElement>('#app');
if (!rootElement) throw new Error('App root not found.');
const root = rootElement;

let session: BrowserSession | null = getStoredSession();
let route = window.location.hash || defaultRoute(session?.permissions ?? []).path;
let apiStatus = apiClient.getNetworkStatus();
let apiStatusMessage = 'API connection healthy.';
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

function renderLogin(): void {
  const shell = el('main', 'login-shell');
  const card = el('form', 'login-card');
  card.innerHTML = `
    <p class="eyebrow">RestaurantPOS</p>
    <h1>Sign in</h1>
    <p>Enter your staff username or email and password. The browser stores only a revocable session token.</p>
    <label>Username or email<input name="identifier" autocomplete="username" placeholder="manager-1" required /></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
    <button type="submit">Start secure session</button>
    <p class="form-error" hidden></p>
  `;
  card.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(card);
    const input = form.get('identifier');
    const password = form.get('password');
    const error = card.querySelector<HTMLParagraphElement>('.form-error');
    try {
      session = await login(String(input ?? ''), String(password ?? ''));
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
  sidebar.innerHTML = `<h1>RestaurantPOS</h1><p>${session.user.id} · ${Array.isArray(session.user.role) ? session.user.role.join(', ') : session.user.role}</p>`;

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
  main.append(banner, content);
  startHealthChecks();
  layout.append(sidebar, main);
  root.replaceChildren(layout);
}

function page(title: string, subtitle: string, actions: string[] = []): HTMLElement {
  const section = el('section', 'page');
  const header = el('header', 'page-header');
  header.innerHTML = `<p class="eyebrow">Deployable frontend client</p><h2>${title}</h2><p>${subtitle}</p>`;
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
  const section = page('Restaurant POS', 'Select a table, enter menu items, split a bill, mark paid, and clean the table for the next guest.');
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
      content = page('Kitchen KDS', 'Kitchen station queue with live KDS event stream support.', ['Queued items', 'Preparing', 'Ready']);
      await attachJsonPreview(content, () => loadKitchenQueue());
      break;
    case '#/bar':
      content = page('Bar KDS', 'Bar station queue built on the same KDS API endpoints.', ['Drink queue', 'Preparing', 'Ready']);
      await attachJsonPreview(content, () => loadBarQueue());
      break;
    case '#/waiter-progress':
      content = page('Waiter progress', 'Waitstaff progress view across kitchen and bar stations.', ['Kitchen progress', 'Bar progress', 'Guest updates']);
      await attachJsonPreview(content, () => loadOrderProgressForWaiter());
      break;
    case '#/menu-admin':
      content = page('Menu admin', 'Manage categories, menu items, availability, and promotions.', ['Categories', 'Items', 'Availability', 'Promotions']);
      await attachJsonPreview(content, () => loadAdminMenuDashboard());
      break;
    case '#/inventory-alerts':
      content = page('Inventory alerts', 'Review low-stock alerts and current inventory deduction policy.', ['Low stock', 'Deduction policy', 'Stock actions']);
      await attachJsonPreview(content, () => loadAdminInventoryAlerts());
      break;
    case '#/reports':
      content = page('Reports', 'Sales, inventory usage, and financial summary report shells.', ['Sales by day', 'Sales by week', 'Sales by month', 'Financial summary']);
      await attachJsonPreview(content, () => apiClient.getSalesReport('day'));
      break;
    case '#/audit':
      content = page('Audit', 'Filter and inspect auditable events from the backend audit API.', ['Search', 'Entity filters', 'Reason filters', 'Snapshots']);
      await attachJsonPreview(content, () => loadAdminAuditViewer(session!.user));
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
  void renderRoute();
}

render();
