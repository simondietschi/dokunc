export default function Loading() {
  return (
    <div className="mx-auto max-w-[760px] px-6 pt-[6.5rem]">
      <div className="skeleton h-10 w-2/3 rounded-lg" />
      <div className="mt-8 space-y-3">
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-11/12 rounded" />
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-3/4 rounded" />
      </div>
    </div>
  );
}
