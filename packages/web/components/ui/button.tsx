import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "ghost" | "outline" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

const variants: Record<Variant, string> = {
  default:
    "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50",
  secondary:
    "bg-muted text-foreground hover:bg-muted/80 disabled:opacity-50",
  ghost:
    "bg-transparent text-foreground hover:bg-muted disabled:opacity-50",
  outline:
    "border border-border bg-transparent text-foreground hover:bg-muted disabled:opacity-50",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-destructive/50",
};

const sizes: Record<Size, string> = {
  default: "h-9 px-4 text-sm",
  sm: "h-8 px-3 text-xs",
  lg: "h-11 px-6 text-base",
  icon: "h-9 w-9",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = "Button";
