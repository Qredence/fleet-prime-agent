import LottieImport from "lottie-react"
import type { ComponentType } from "react"

type LottieComponent = ComponentType<Record<string, unknown>>

const resolvedLottieImport =
  typeof LottieImport === "function"
    ? (LottieImport as LottieComponent)
    : (LottieImport as { default?: LottieComponent }).default

if (typeof resolvedLottieImport !== "function") {
  throw new Error("Failed to resolve lottie-react component export")
}

const resolvedLottie: LottieComponent = resolvedLottieImport

export default resolvedLottie
