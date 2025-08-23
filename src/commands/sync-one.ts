import { sync } from "./sync";

// sync-one is just an alias for sync
export async function syncOne(options?: { autoPush?: boolean }): Promise<void> {
  if (options) {
    await sync(options);
  } else {
    await sync();
  }
}
