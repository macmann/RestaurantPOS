import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import { query, withTransaction, type DatabaseClient } from '../db/client';
import { acknowledgeIncoming, createCustomerAccount, getIncomingEvents, receiveOutgoingBatch, requireSyncToken, syncHealth, type SyncEvent } from './service';
import { authorize } from '../auth/middleware';
import { Actions } from '../auth/permissions';
import { AdminMenuApi } from '../menu/controller';
import { getCategoryById, getItemById, listItems } from '../menu/repository';

const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
const text = (value: unknown, field: string) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`); return value.trim(); };
const syncAuth = (req: Request, _res: Response, next: NextFunction) => { try { requireSyncToken((req.headers ?? {})['x-sync-token']); next(); } catch (e) { next(e); } };

export function buildCloudRouter(): Router {
  const router = express.Router();
  router.post('/sync/events', syncAuth, route(async (req, res) => res.json({ data: await receiveOutgoingBatch(((req.body as any)?.events ?? []) as SyncEvent[]) })));
  router.get('/sync/incoming', syncAuth, route(async (req, res) => res.json({ data: { events: await getIncomingEvents(text((req.query as any)?.storeId, 'storeId')) } })));
  router.post('/sync/incoming/ack', syncAuth, route(async (req, res) => { await acknowledgeIncoming(text((req.body as any)?.storeId, 'storeId'), (req.body as any)?.eventIds ?? []); res.json({ data: { ok: true } }); }));
  router.post('/sync/heartbeat', syncAuth, route(async (req, res) => {
    const b: any = req.body ?? {};
    await query(`INSERT INTO store_sync_status(store_id,device_id,last_seen_at,last_successful_sync_at,last_pos_activity_at,pending_event_count,failed_event_count,application_version,last_error) VALUES($1,$2,NOW(),NOW(),$3,$4,$5,$6,NULL) ON CONFLICT(store_id) DO UPDATE SET device_id=EXCLUDED.device_id,last_seen_at=NOW(),last_successful_sync_at=NOW(),last_pos_activity_at=EXCLUDED.last_pos_activity_at,pending_event_count=EXCLUDED.pending_event_count,failed_event_count=EXCLUDED.failed_event_count,application_version=EXCLUDED.application_version,last_error=NULL`, [text(b.storeId,'storeId'),text(b.deviceId,'deviceId'),b.lastPosActivity ?? null,Number(b.pendingEventCount ?? 0),Number(b.failedEventCount ?? 0),b.applicationVersion ?? null]);
    res.json({ data: { ok: true } });
  }));
  return router;
}

export function buildManagerRouter(): Router {
  const router = express.Router();
  const managerStore = (req: Request): string => req.user?.branchId ?? process.env.POS_STORE_ID ?? 'default';
  const assertStore = (req: Request, record: { branchId: string } | null): void => {
    if (!record || record.branchId !== managerStore(req)) throw Object.assign(new Error('Menu record not found for this manager store.'), { statusCode: 404 });
  };
  const queueMenuEvent = async (client: DatabaseClient, storeId: string, eventType: string, record: any) => {
    const event = await client.query<any>('SELECT gen_random_uuid() event_id');
    const eventId = event.rows[0].event_id;
    record.originatingEventId = eventId;
    const namespace = eventType.startsWith('MENU_ITEM_') ? 'menu:items' : 'menu:categories';
    await client.query('UPDATE repository_records SET payload=$3::jsonb WHERE namespace=$1 AND record_key=$2', [namespace, record.id, JSON.stringify(record)]);
    await client.query('INSERT INTO incoming_pos_events(event_id,store_id,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5)', [eventId, storeId, eventType, record.id, JSON.stringify(record)]);
    return record;
  };
  router.get('/summary', route(async (req, res) => {
    const storeId = text((req.query as any)?.storeId ?? process.env.POS_STORE_ID ?? 'default', 'storeId');
    const [orders, payments, health] = await Promise.all([
      query<any>(`SELECT COUNT(*)::int count, COALESCE(SUM(grand_total),0) total FROM orders WHERE created_at >= CURRENT_DATE`),
      query<any>(`SELECT method, COALESCE(SUM(amount),0) total FROM payments WHERE created_at >= CURRENT_DATE GROUP BY method`),
      syncHealth(storeId),
    ]);
    res.json({ data: { dailySales: orders.rows[0], paymentBreakdown: payments.rows, sync: health } });
  }));
  router.get('/orders', route(async (_req,res) => res.json({ data: (await query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200')).rows })));
  router.get('/menu', route(async (req,res) => res.json({ data: (await AdminMenuApi.list()).filter((category) => category.branchId === managerStore(req)) })));
  router.post('/menu/categories', authorize(Actions.ManageMenu), route(async(req,res)=>{const storeId=managerStore(req);const record=await withTransaction(async(client)=>{const created=await AdminMenuApi.createCategory({...(req.body as any),branchId:storeId},{source:'CLOUD_MANAGER',actorId:req.user?.id});return queueMenuEvent(client,storeId,'CATEGORY_CREATED',created);});res.status(201).json({data:record});}));
  router.patch('/menu/categories/:id', authorize(Actions.ManageMenu), route(async(req,res)=>{const storeId=managerStore(req);assertStore(req,await getCategoryById(text(req.params.id,'id')));const record=await withTransaction(async(client)=>queueMenuEvent(client,storeId,'CATEGORY_UPDATED',await AdminMenuApi.updateCategory(text(req.params.id,'id'),req.body as any,{source:'CLOUD_MANAGER',actorId:req.user?.id})));res.json({data:record});}));
  router.delete('/menu/categories/:id', authorize(Actions.ManageMenu), route(async(req,res)=>{const storeId=managerStore(req);const id=text(req.params.id,'id');const existing=await getCategoryById(id);assertStore(req,existing);const children=await listItems(id);const record=await withTransaction(async(client)=>{await AdminMenuApi.deleteCategory(id,{source:'CLOUD_MANAGER',actorId:req.user?.id});const timestamp=new Date().toISOString();for(const child of children)await queueMenuEvent(client,storeId,'MENU_ITEM_DELETED',{...child,deletedAt:timestamp,isActive:false,isAvailable:false,updatedAt:timestamp,updatedSource:'CLOUD_MANAGER',updatedBy:req.user?.id});return queueMenuEvent(client,storeId,'CATEGORY_DELETED',{...(existing as any),deletedAt:timestamp,isActive:false,updatedAt:timestamp,updatedSource:'CLOUD_MANAGER',updatedBy:req.user?.id});});res.json({data:record});}));
  router.post('/menu/items', authorize(Actions.ManageMenu), route(async(req,res)=>{const storeId=managerStore(req);assertStore(req,await getCategoryById((req.body as any).categoryId));const record=await withTransaction(async(client)=>queueMenuEvent(client,storeId,'MENU_ITEM_CREATED',await AdminMenuApi.createItem({...(req.body as any),branchId:storeId},{source:'CLOUD_MANAGER',actorId:req.user?.id})));res.status(201).json({data:record});}));
  router.patch('/menu/items/:id', authorize(Actions.ManageMenu), route(async(req,res)=>{const storeId=managerStore(req);assertStore(req,await getItemById(text(req.params.id,'id')));if((req.body as any).categoryId)assertStore(req,await getCategoryById((req.body as any).categoryId));const record=await withTransaction(async(client)=>queueMenuEvent(client,storeId,'MENU_ITEM_UPDATED',await AdminMenuApi.updateItem(text(req.params.id,'id'),req.body as any,{source:'CLOUD_MANAGER',actorId:req.user?.id})));res.json({data:record});}));
  router.patch('/menu/items/:id/availability', authorize(Actions.ManageMenu), route(async(req,res)=>{const storeId=managerStore(req);assertStore(req,await getItemById(text(req.params.id,'id')));const record=await withTransaction(async(client)=>queueMenuEvent(client,storeId,'MENU_ITEM_UPDATED',await AdminMenuApi.setAvailability(text(req.params.id,'id'),Boolean((req.body as any).isAvailable),{source:'CLOUD_MANAGER',actorId:req.user?.id})));res.json({data:record});}));
  router.delete('/menu/items/:id', authorize(Actions.ManageMenu), route(async(req,res)=>{const storeId=managerStore(req);const existing=await getItemById(text(req.params.id,'id'));assertStore(req,existing);const record=await withTransaction(async(client)=>{await AdminMenuApi.deleteItem(text(req.params.id,'id'),{source:'CLOUD_MANAGER',actorId:req.user?.id});return queueMenuEvent(client,storeId,'MENU_ITEM_DELETED',{...(existing as any),deletedAt:new Date().toISOString(),isActive:false,isAvailable:false,updatedAt:new Date().toISOString(),updatedSource:'CLOUD_MANAGER',updatedBy:req.user?.id});});res.json({data:record});}));
  router.get('/sync-health', route(async (req,res) => res.json({ data: await syncHealth(text((req.query as any)?.storeId ?? process.env.POS_STORE_ID ?? 'default','storeId')) })));
  return router;
}

export function buildCustomerRouter(): Router {
  const router = express.Router();
  router.get('/menu', route(async (_req,res) => { const categories=await AdminMenuApi.list(); res.json({data:categories.filter(c=>c.isActive).flatMap(c=>c.items.filter(i=>i.isActive&&i.isAvailable).map(i=>({...i,categoryId:c.id,categoryName:c.name})))}); }));
  router.post('/accounts', route(async (req,res) => res.status(201).json({ data: await createCustomerAccount(text((req.body as any)?.name,'name'),text((req.body as any)?.phone,'phone')) })));
  router.post('/orders', route(async (req,res) => {
    const b: any=req.body ?? {}; const items=Array.isArray(b.items)?b.items:[]; if(!items.length) throw new Error('items is required.');
    const health=await syncHealth(text(b.storeId,'storeId')); const id=(await query<any>('SELECT gen_random_uuid() id')).rows[0].id;
    await withTransaction(async(client)=>{
      const account = await client.query<any>('SELECT id FROM customer_web_accounts WHERE id=$1 AND phone=$2', [b.customerId, text(b.customerPhone,'customerPhone')]);
      if (!account.rowCount) throw new Error('Customer account does not match the supplied phone.');
      const menu=(await listItems()).filter(m=>m.branchId===b.storeId&&m.isActive&&m.isAvailable&&items.some((i:any)=>i.menuItemId===m.id));
      if(menu.length!==new Set(items.map((i:any)=>i.menuItemId)).size) throw new Error('One or more menu items are unavailable.');
      const byId=new Map(menu.map((m:any)=>[m.id,m])); const total=items.reduce((n:number,i:any)=>n+Number(byId.get(i.menuItemId).price)*Number(i.quantity),0); const createdAt=new Date().toISOString();
      await client.query(`INSERT INTO online_orders(id,store_id,customer_id,customer_name,customer_phone,requested_pickup_at,total) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,b.storeId,b.customerId,text(b.customerName,'customerName'),text(b.customerPhone,'customerPhone'),b.requestedPickupAt ?? null,total]);
      for(const i of items){const m=byId.get(i.menuItemId); await client.query('INSERT INTO online_order_items(online_order_id,menu_item_id,name,quantity,unit_price) VALUES($1,$2,$3,$4,$5)',[id,m.id,m.name,Number(i.quantity),m.price]);}
      const payload={id,storeId:b.storeId,customerId:b.customerId,customerName:b.customerName,customerPhone:b.customerPhone,requestedPickupAt:b.requestedPickupAt,total,createdAt};
      await client.query(`INSERT INTO incoming_pos_events(store_id,event_type,aggregate_id,payload) VALUES($1,'ONLINE_ORDER_CREATED',$2,$3)`,[b.storeId,id,payload]);
    });
    res.status(201).json({data:{id,status:'SUBMITTED',restaurantSyncState:health.state,confirmationPending:true}});
  }));
  router.post('/reservations', route(async(req,res)=>{const b: any=req.body??{}; const result=await withTransaction(async(client)=>{const account=await client.query<any>('SELECT id FROM customer_web_accounts WHERE id=$1 AND phone=$2',[b.customerId,text(b.customerPhone,'customerPhone')]); if(!account.rowCount) throw new Error('Customer account does not match the supplied phone.'); const created=await client.query<any>(`INSERT INTO reservations(store_id,customer_id,customer_name,customer_phone,requested_at,party_size,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[text(b.storeId,'storeId'),b.customerId,text(b.customerName,'customerName'),b.customerPhone,b.requestedAt,Number(b.partySize),b.notes??null]); const r=created.rows[0]; await client.query(`INSERT INTO incoming_pos_events(store_id,event_type,aggregate_id,payload) VALUES($1,'RESERVATION_CREATED',$2,$3)`,[r.store_id,r.id,{id:r.id,storeId:r.store_id,customerId:r.customer_id,customerName:r.customer_name,customerPhone:r.customer_phone,requestedAt:r.requested_at,partySize:r.party_size,notes:r.notes,createdAt:r.created_at}]); return r;}); res.status(201).json({data:result});}));
  router.get('/orders/:id', route(async(req,res)=>res.json({data:(await query('SELECT id,status,requested_pickup_at,total,created_at,updated_at FROM online_orders WHERE id=$1',[text(req.params.id,'id')])).rows[0]??null})));
  router.get('/reservations/:id', route(async(req,res)=>res.json({data:(await query('SELECT id,status,requested_at,party_size,created_at,updated_at FROM reservations WHERE id=$1',[text(req.params.id,'id')])).rows[0]??null})));
  return router;
}
