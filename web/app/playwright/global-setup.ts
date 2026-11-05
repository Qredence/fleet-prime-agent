import { SMOKE_STATE_DIR_ENV } from "./hermetic-state"
import { reapAbandonedSmokeDaemons } from "./smoke-processes"

/** Clean up after earlier runs whose global teardown never ran. */
export default async function globalSetup() {
	await reapAbandonedSmokeDaemons(process.env[SMOKE_STATE_DIR_ENV])
}
