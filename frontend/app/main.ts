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

const rootElement = document.querySelector<HTMLDivElement>('#app');
if (!rootElement) throw new Error('App root not found.');
const root = rootElement;

let session: BrowserSession | null = getStoredSession();
let route = window.location.hash || defaultRoute(session?.permissions ?? []).path;
let apiStatus = apiClient.getNetworkStatus();
let apiStatusMessage = 'API connection healthy.';
let healthTimer: number | undefined;

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

async function renderRoute(): Promise<void> {
  if (!session) return renderLogin();
  const current = activeRoute();
  let content: HTMLElement;

  switch (current.path) {
    case '#/tables':
      content = page('Table floor', 'Open table sessions and monitor available, occupied, and inactive tables.', ['Open session', 'Guest count', 'Occupied status', 'Close session']);
      await attachJsonPreview(content, () => loadCashierTableFloor(session!.user.branchId));
      break;
    case '#/orders':
      content = page('Cashier order entry', 'Create dine-in and takeout drafts, edit carts, and advance order status.', ['Dine-in order', 'Takeout order', 'Cart editor', 'Status transition']);
      await attachJsonPreview(content, () => apiClient.listOrders());
      break;
    case '#/billing':
      content = page('Billing', 'Generate bills, toggle tax, apply promotions, preview receipts, and take payments.', ['Bill generation', 'Tax mode', 'Promotions', 'Receipt preview']);
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
