import { strict as assert } from 'node:assert';
import { compareMenuVersions } from '../backend/sync/service';
import { Actions, RolePermissions } from '../backend/auth/permissions';
import { cloudOperationalMethodAllowed } from '../backend/server';

type MenuRecord = { id: string; price: number; updatedAt: string; updatedSource: 'LOCAL_POS'|'CLOUD_MANAGER'; deletedAt?: string };
const record = (price: number, updatedAt: string, updatedSource: MenuRecord['updatedSource'], deletedAt?: string): MenuRecord => ({ id:'item-shared',price,updatedAt,updatedSource,deletedAt });
const apply = (current: MenuRecord|undefined, incoming: MenuRecord): MenuRecord => compareMenuVersions(incoming,current)==='NEWER' ? {...incoming} : {...current!};

// Scenarios 1-3: either side creates with the stable id; a newer manager edit wins locally.
let cloud: MenuRecord|undefined = record(8500,'2026-09-23T10:00:00.000Z','LOCAL_POS');
let local: MenuRecord|undefined = apply(undefined,cloud);
assert.equal(local.id,cloud.id);
cloud=apply(cloud,record(9000,'2026-09-23T10:05:00.000Z','CLOUD_MANAGER'));
local=apply(local,cloud);
assert.equal(local.price,9000);

// Scenarios 4, 5 and 10: independent edits deterministically converge to the newest trusted timestamp.
local=record(9500,'2026-09-23T10:10:00.000Z','LOCAL_POS');
local=apply(local,record(9000,'2026-09-23T10:05:00.000Z','CLOUD_MANAGER'));
assert.equal(local.price,9500);
cloud=record(9000,'2026-09-23T10:10:00.000Z','CLOUD_MANAGER');
cloud=apply(cloud,record(8750,'2026-09-23T10:05:00.000Z','LOCAL_POS'));
assert.equal(cloud.price,9000);
local=apply(local,cloud); cloud=apply(cloud,local);
assert.equal(local.price,cloud.price);

// Scenarios 6, 7 and 11: replaying an equal version is idempotent and cannot create a sync loop.
assert.equal(compareMenuVersions(cloud,cloud),'EQUAL');
const replayed=apply(cloud,cloud);
assert.deepEqual(replayed,cloud);
assert.equal(compareMenuVersions(replayed,cloud),'EQUAL');

// Scenario 8: tombstones obey LWW and an older update cannot resurrect a deleted item.
const tombstone=record(9000,'2026-09-23T11:00:00.000Z','CLOUD_MANAGER','2026-09-23T11:00:00.000Z');
local=apply(local,tombstone);
local=apply(local,record(9700,'2026-09-23T10:59:00.000Z','LOCAL_POS'));
assert.equal(local.deletedAt,tombstone.deletedAt);
const restored=record(9800,'2026-09-23T11:05:00.000Z','LOCAL_POS');
assert.equal(apply(local,restored).deletedAt,undefined);

// Scenario 9: queued changes on different identities remain independent during an outage.
const offlineLocal=record(9900,'2026-09-23T12:00:00.000Z','LOCAL_POS');
const offlineCloud={...record(5000,'2026-09-23T12:01:00.000Z','CLOUD_MANAGER'),id:'different-item'};
assert.equal(apply(undefined,offlineLocal).price,9900);
assert.equal(apply(undefined,offlineCloud).price,5000);

// Scenario 12: manager has the narrow menu capability, while cloud operational writes remain blocked.
assert.ok(RolePermissions.manager.includes(Actions.ManageMenu));
assert.equal(cloudOperationalMethodAllowed('GET'),true);
assert.equal(cloudOperationalMethodAllowed('POST'),false);
assert.equal(cloudOperationalMethodAllowed('PATCH'),false);
assert.equal(cloudOperationalMethodAllowed('DELETE'),false);

assert.throws(()=>compareMenuVersions({updatedAt:'browser-garbage'},cloud),/valid trusted/);
console.log('Bidirectional menu LWW, tombstone, replay, outage, and authorization tests passed.');
