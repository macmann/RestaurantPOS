import { getStoredSession, login, logout, type BrowserSession } from '../auth/session';
import { appRoutes, canAccessRoute, defaultRoute, visibleRoutes, type AppRoute } from '../auth/navigation';
import { loadKitchenQueue } from '../kds/kitchen-screen';
import { loadBarQueue } from '../kds/bar-screen';
import { loadOrderProgressForWaiter } from '../waiter/order-progress';
import { loadAdminMenuDashboard } from '../admin/menu-management';
import { loadAdminInventoryAlerts } from '../admin/inventory-alerts';
import { loadAdminAuditViewer } from '../admin/audit-viewer';
import { apiClient } from '../api/client';

const rootElement = document.querySelector<HTMLDivElement>('#app');
if (!rootElement) throw new Error('App root not found.');
const root = rootElement;

let session: BrowserSession | null = getStoredSession();
let route = window.location.hash || defaultRoute(session?.permissions ?? []).path;

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
    <p>Enter an active backend user ID. The browser stores only the selected session user and sends it as <code>x-user-id</code>.</p>
    <label>User ID<input name="userId" autocomplete="username" placeholder="manager-1" required /></label>
    <button type="submit">Start session</button>
    <p class="form-error" hidden></p>
  `;
  card.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = new FormData(card).get('userId');
    const error = card.querySelector<HTMLParagraphElement>('.form-error');
    try {
      session = await login(String(input ?? ''));
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
    logout();
    session = null;
    renderLogin();
  });
  sidebar.append(signOut);

  const main = el('main', 'content');
  main.append(content);
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
    case '#/staff-settings':
      content = page('Staff & settings administration', 'Administer users and branch/runtime settings.', ['Staff users', 'Activation', 'Branch settings', 'Inventory settings']);
      await attachJsonPreview(content, async () => ({ users: await apiClient.listUsers(), settings: await apiClient.getSettings() }));
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
