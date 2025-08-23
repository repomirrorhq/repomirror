import { sync } from "./sync";

// sync-one is just an alias for sync
export async function syncOne(): Promise<void> {
  await sync();
}
