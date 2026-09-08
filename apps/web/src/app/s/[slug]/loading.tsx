import { Skeleton, SkeletonText } from "@/components/ui/PageSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[760px] px-6 pt-16">
      <Skeleton className="h-10 w-2/3" />
      <SkeletonText lines={6} className="mt-8" />
    </div>
  );
}
