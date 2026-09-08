import { SkeletonList, SkeletonTitle } from "@/components/ui/PageSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <SkeletonTitle />
      <SkeletonList rows={4} />
    </div>
  );
}
