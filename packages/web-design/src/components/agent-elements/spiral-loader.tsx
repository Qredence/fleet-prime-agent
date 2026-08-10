"use client"

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { cn } from "./utils/cn"
import { spiralFastData, spiralSlowData } from "./spiral-loader-data"
import type { CSSProperties } from "react"
import type { LottieComponentProps, LottieRefCurrentProps } from "lottie-react"

const LottieLazy = lazy(() => import("./spiral-loader-lottie"))

function Lottie(props: LottieComponentProps) {
  return (
    <Suspense fallback={null}>
      <LottieLazy {...props} />
    </Suspense>
  )
}

const FAST_REPEATS = 4
const SLOW_REPEATS = 2

export type SpiralLoaderProps = {
  size?: number
  className?: string
}

export function SpiralLoader({ size = 16, className }: SpiralLoaderProps) {
  const [isMounted, setIsMounted] = useState(false)
  const [phase, setPhase] = useState<"fast" | "slow">("fast")
  const repeatCountRef = useRef(0)
  const fastRef = useRef<LottieRefCurrentProps | null>(null)
  const slowRef = useRef<LottieRefCurrentProps | null>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const startFastPhase = useCallback(() => {
    repeatCountRef.current = 0
    setPhase("fast")
    slowRef.current?.stop()
    fastRef.current?.goToAndPlay(0, true)
  }, [])

  const startSlowPhase = useCallback(() => {
    repeatCountRef.current = 0
    setPhase("slow")
    fastRef.current?.stop()
    slowRef.current?.goToAndPlay(0, true)
  }, [])

  const handleFastComplete = useCallback(() => {
    repeatCountRef.current += 1
    if (repeatCountRef.current < FAST_REPEATS) {
      fastRef.current?.goToAndPlay(0, true)
    } else {
      startSlowPhase()
    }
  }, [startSlowPhase])

  const handleSlowComplete = useCallback(() => {
    repeatCountRef.current += 1
    if (repeatCountRef.current < SLOW_REPEATS) {
      slowRef.current?.goToAndPlay(0, true)
    } else {
      startFastPhase()
    }
  }, [startFastPhase])

  if (!isMounted) return null
  const needsInvert = resolvedTheme !== "dark"

  return (
    <div
      className={cn("relative size-(--spiral-size) shrink-0", className)}
      style={{ "--spiral-size": `${size}px` } as CSSProperties}
    >
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-75",
          needsInvert && "invert",
          phase === "fast" ? "opacity-100" : "opacity-0"
        )}
      >
        <Lottie
          lottieRef={fastRef}
          animationData={spiralFastData}
          loop={false}
          autoplay={true}
          onComplete={handleFastComplete}
          className="size-full"
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-75",
          needsInvert && "invert",
          phase === "slow" ? "opacity-100" : "opacity-0"
        )}
      >
        <Lottie
          lottieRef={slowRef}
          animationData={spiralSlowData}
          loop={false}
          autoplay={false}
          onComplete={handleSlowComplete}
          className="size-full"
        />
      </div>
    </div>
  )
}
