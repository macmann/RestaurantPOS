const root = document.querySelector<HTMLDivElement>('#app');

function shell(title: string, subtitle: string): HTMLElement {
  if (!root) throw new Error('App root not found.');
  document.title = `${title} · SYM`;
  root.innerHTML = `<main class="remote-shell"><header><span class="brand">SYM</span><div><h1>${title}</h1><p>${subtitle}</p></div></header><section id="remote-content" class="remote-grid"><p>Loading…</p></section></main>`;
  return document.querySelector('#remote-content') as HTMLElement;
}

const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] ?? c));

async function manager(): Promise<void> {
  const content = shell('Manager overview', 'Read-only cloud mirror');
  try {
    const stored = JSON.parse(window.localStorage.getItem('sym-pos-session') ?? 'null');
    if (!stored?.token) {
      content.innerHTML = `<article class="remote-card"><h2>Manager sign in</h2><form id="manager-login"><label>Username or email<input name="identifier" required></label><label>Password<input name="password" type="password" required></label><button>Sign in</button></form><p id="login-error"></p></article>`;
      document.querySelector<HTMLFormElement>('#manager-login')?.addEventListener('submit', async (event) => {
        event.preventDefault(); const form=new FormData(event.currentTarget as HTMLFormElement); const response=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:form.get('identifier'),password:form.get('password')})});
        const body=await response.json(); if(!response.ok){const e=document.querySelector('#login-error');if(e)e.textContent=body.error??'Sign in failed.';return;} window.localStorage.setItem('sym-pos-session',JSON.stringify(body.data)); await manager();
      });
      return;
    }
    const authFetch = (url:string, options:RequestInit={}) => fetch(url,{...options,headers:{...(options.headers??{}),authorization:`Bearer ${stored.token}`,'content-type':'application/json'}});
    const [summaryResponse,menuResponse] = await Promise.all([authFetch('/manager-api/summary'),authFetch('/manager-api/menu')]); if(!summaryResponse.ok||!menuResponse.ok) throw new Error('Unauthorized'); const { data } = await summaryResponse.json(); const menu=(await menuResponse.json()).data;
    content.innerHTML = `<article class="remote-card"><small>Today's orders</small><strong>${escape(data.dailySales.count)}</strong><p>Sales ${escape(data.dailySales.total)}</p></article><article class="remote-card"><small>Sync state</small><strong class="sync-${String(data.sync.state).toLowerCase().replaceAll(' ','-')}">${escape(data.sync.state)}</strong><p>Data age ${Math.round(data.sync.ageSeconds ?? 0)}s</p><p>Last POS activity ${escape(data.sync.last_pos_activity_at ?? 'Unknown')}</p><p>Last successful sync ${escape(data.sync.last_successful_sync_at ?? 'Unknown')}</p></article><article class="remote-card wide"><h2>Payment breakdown <small>read only</small></h2>${data.paymentBreakdown.map((p:any)=>`<p>${escape(p.method)} <b>${escape(p.total)}</b></p>`).join('') || '<p>No payments today.</p>'}</article><article class="remote-card wide"><h2>Menu administration</h2><p>Menu changes save in cloud now and are delivered to the selected restaurant through its durable sync queue.</p><form id="category-create" class="remote-form"><input name="name" placeholder="New category" required><input name="sortOrder" type="number" value="0"><button>Add category</button></form>${menu.map((c:any)=>`<section class="manager-category"><h3>${escape(c.name)} <button data-category-edit="${escape(c.id)}" data-name="${escape(c.name)}">Rename</button> <button class="danger" data-category-delete="${escape(c.id)}">Archive</button></h3>${c.items.map((i:any)=>`<div class="menu-row"><span><b>${escape(i.name)}</b><small>${escape(i.description||'')} · ${escape(i.prepStation||'No station')} · updated by ${escape(i.updatedSource||'unknown')}</small></span><span>${escape(i.price)} <button data-edit="${escape(i.id)}" data-name="${escape(i.name)}" data-price="${escape(i.price)}">Edit</button> <button data-toggle="${escape(i.id)}" data-available="${!i.isAvailable}">${i.isAvailable?'Mark sold out':'Enable'}</button> <button class="danger" data-delete="${escape(i.id)}">Archive</button></span></div>`).join('')}<form class="remote-form item-create" data-category="${escape(c.id)}"><input name="name" placeholder="Item name" required><input name="price" type="number" min="0" step="0.01" placeholder="Price" required><input name="description" placeholder="Description"><button>Add item</button></form></section>`).join('')}</article>`;
    document.querySelector<HTMLFormElement>('#category-create')?.addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(event.currentTarget as HTMLFormElement);await authFetch('/manager-api/menu/categories',{method:'POST',body:JSON.stringify({name:f.get('name'),sortOrder:Number(f.get('sortOrder'))})});await manager();});
    document.querySelectorAll<HTMLFormElement>('.item-create').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(event.currentTarget as HTMLFormElement);await authFetch('/manager-api/menu/items',{method:'POST',body:JSON.stringify({categoryId:(event.currentTarget as HTMLFormElement).dataset.category,name:f.get('name'),price:Number(f.get('price')),description:f.get('description')})});await manager();}));
    content.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(button=>button.addEventListener('click',async()=>{await authFetch(`/manager-api/menu/items/${button.dataset.toggle}/availability`,{method:'PATCH',body:JSON.stringify({isAvailable:button.dataset.available==='true'})});await manager();}));
    content.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(button=>button.addEventListener('click',async()=>{const name=window.prompt('Item name',button.dataset.name);const price=window.prompt('Price',button.dataset.price);if(!name||price===null)return;await authFetch(`/manager-api/menu/items/${button.dataset.edit}`,{method:'PATCH',body:JSON.stringify({name,price:Number(price)})});await manager();}));
    content.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(button=>button.addEventListener('click',async()=>{await authFetch(`/manager-api/menu/items/${button.dataset.delete}`,{method:'DELETE'});await manager();}));
    content.querySelectorAll<HTMLButtonElement>('[data-category-edit]').forEach(button=>button.addEventListener('click',async()=>{const name=window.prompt('Category name',button.dataset.name);if(!name)return;await authFetch(`/manager-api/menu/categories/${button.dataset.categoryEdit}`,{method:'PATCH',body:JSON.stringify({name})});await manager();}));
    content.querySelectorAll<HTMLButtonElement>('[data-category-delete]').forEach(button=>button.addEventListener('click',async()=>{await authFetch(`/manager-api/menu/categories/${button.dataset.categoryDelete}`,{method:'DELETE'});await manager();}));
  } catch { content.innerHTML = '<article class="remote-card"><h2>Remote status unknown</h2><p>The cloud view is unavailable. This does not mean the restaurant POS is offline.</p></article>'; }
}

async function customer(): Promise<void> {
  const content = shell('Order for pickup', 'Requests require restaurant confirmation');
  try {
    const response=await fetch('/customer-api/menu'); const {data}=await response.json();
    content.innerHTML=`<article class="remote-card wide"><h2>Menu</h2>${data.map((i:any)=>`<div class="menu-row"><span><b>${escape(i.name)}</b><small>${escape(i.categoryName)}</small></span><span>${escape(i.price)}</span></div>`).join('')||'<p>The menu is not currently available.</p>'}</article><article class="remote-card"><h2>Pickup requests</h2><p>Sign in with a verified customer account to submit and track a request. Submission is not acceptance.</p></article><article class="remote-card"><h2>Reservations</h2><p>Reservation requests remain pending until confirmed by the restaurant.</p></article>`;
  } catch { content.innerHTML='<article class="remote-card"><h2>Ordering unavailable</h2><p>Please try again later. No request has been submitted.</p></article>'; }
}

export function renderRemoteSurface(surface: 'manager'|'customer'): Promise<void> { return surface === 'manager' ? manager() : customer(); }
