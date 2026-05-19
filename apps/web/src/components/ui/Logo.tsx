import { cn } from "@/lib/cn";

export function Logo({
  className,
  withWordmark = true,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative grid h-7 w-7 place-items-center rounded-[9px] bg-gradient-to-br from-accent to-violet-500 shadow-soft">
        <span className="h-2.5 w-2.5 rounded-[3px] bg-white/95" />
      </span>
      {withWordmark && (
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          dokunc
        </span>
      )}
    </span>
  );
}
