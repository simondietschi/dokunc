import { SkeletonList, SkeletonTitle } from "@/components/ui/PageSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl px-8 py-14">
      <SkeletonTitle />
      <SkeletonList rows={2} />
    </div>
  );
}
