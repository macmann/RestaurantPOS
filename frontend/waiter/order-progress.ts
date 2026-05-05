import { onKdsEvent } from '../../backend/kds/controller';
import { getKdsSnapshot } from '../../backend/kds/service';

export async function loadOrderProgressForWaiter() {
  return getKdsSnapshot();
}

export function subscribeOrderProgressForWaiter(onUpdate: Parameters<typeof onKdsEvent>[0]) {
  return onKdsEvent(onUpdate);
}
