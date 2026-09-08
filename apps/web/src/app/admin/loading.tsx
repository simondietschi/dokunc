import {
  SkeletonHeader,
  SkeletonList,
  SkeletonTitle,
} from "@/components/ui/PageSkeleton";

export default function Loading() {
  return (
    <div className="min-h-screen">
      <SkeletonHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <SkeletonTitle />
        <SkeletonList rows={5} withAvatar />
      </main>
    </div>
  );
}
