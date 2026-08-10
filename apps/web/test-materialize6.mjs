import { SessionManager } from "@earendil-works/pi-coding-agent"
import { existsSync, readFileSync } from "node:fs"

const sm = SessionManager.create("/Volumes/SSD-T7/qredence-environnement/fleet-prime-agent/prime-agent/apps/web")
const target = sm.materializeSessionFile()
sm.flushNow()
console.log("after flushNow exists?", existsSync(target))
if (existsSync(target)) {
  console.log("content preview:", readFileSync(target, 'utf8').slice(0, 300))
}
