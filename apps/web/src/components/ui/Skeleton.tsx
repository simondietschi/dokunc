import { cn } from "@/lib/cn";

/** Platzhalterfläche für Ladezustände (Shimmer kommt aus globals.css). */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton rounded-lg", className)}
      {...props}
    />
  );
}

/** Mehrere Textzeilen, letzte Zeile bewusst kürzer. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3.5"
          style={{ width: i === lines - 1 ? "58%" : "100%" }}
        />
      ))}
    </div>
  );
}
