import {
  Skeleton,
  SkeletonHeader,
  SkeletonTitle,
} from "@/components/ui/PageSkeleton";

export default function Loading() {
  return (
    <div className="min-h-screen">
      <SkeletonHeader />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <SkeletonTitle wide />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="rounded-xl border border-line bg-surface p-5"
            >
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="mt-4 h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-2/3" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
