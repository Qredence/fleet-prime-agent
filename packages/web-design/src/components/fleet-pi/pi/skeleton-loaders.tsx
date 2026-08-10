import { Skeleton } from "../../skeleton"

export function ResourcesSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-1">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-7 w-22 rounded-full" />
          <Skeleton className="h-7 w-18 rounded-full" />
          <Skeleton className="h-7 w-26 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20" />
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-30 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export function WorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-1">
      <Skeleton className="h-7 w-full rounded-sm" />
      <Skeleton className="h-6 w-[90%]" />
      <Skeleton className="h-6 w-[85%]" />
      <Skeleton className="h-6 w-[70%]" />
      <Skeleton className="h-6 w-[80%]" />
      <Skeleton className="h-6 w-[60%]" />
      <Skeleton className="h-6 w-[75%]" />
      <Skeleton className="h-6 w-[55%]" />
    </div>
  )
}

export function WorkspacePreviewSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[95%]" />
      <Skeleton className="h-4 w-[80%]" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[70%]" />
      <Skeleton className="h-4 w-[90%]" />
      <Skeleton className="h-4 w-[60%]" />
    </div>
  )
}
