"use client";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover shadow-sm",
  secondary: "bg-surface text-fg border border-border-strong hover:bg-surface-2 shadow-sm",
  soft: "bg-primary-soft text-primary-ink hover:bg-[color-mix(in_oklab,var(--primary)_16%,var(--surface))]",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white hover:opacity-90 dark:text-black shadow-sm",
  link: "text-primary-ink underline-offset-4 hover:underline",
};
const sizes = {
  sm: "h-9 px-3 text-[13px] rounded-md gap-1.5",
  md: "h-11 md:h-10 px-4 text-sm rounded-lg gap-2",
  lg: "h-12 px-5 text-[15px] rounded-xl gap-2",
  icon: "h-11 w-11 md:h-10 md:w-10 rounded-lg",
  "icon-sm": "h-9 w-9 rounded-md",
};
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants; size?: keyof typeof sizes; loading?: boolean; asChild?: boolean;
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, asChild, className, children, disabled, type = "button", ...props }, ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      {...(asChild ? {} : { type, disabled: disabled || loading })}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium whitespace-nowrap disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant], sizes[size], className,
      )}
      {...props}
    >
      {asChild ? children : (<>{loading && <Loader2 className="animate-spin" aria-hidden />}{size.startsWith("icon") && loading ? null : children}</>)}
    </Comp>
  );
});
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, variant = "ghost", size = "icon", ...props }, ref,
) {
  return <Button ref={ref} variant={variant} size={size} aria-label={label} title={label} {...props} />;
});
