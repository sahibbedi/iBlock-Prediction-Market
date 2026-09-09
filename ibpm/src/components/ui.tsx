import React, { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Link as WouterLink } from "wouter";

// --- BUTTON ---
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "danger" | "yes" | "no";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", isLoading, children, disabled, ...props }, ref) => {
    const variants = {
      default: "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      outline: "border border-border bg-transparent hover:bg-muted text-foreground",
      ghost: "bg-transparent hover:bg-muted text-foreground",
      danger: "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20 hover:bg-destructive/90",
      yes: "bg-yes text-yes-foreground shadow-lg shadow-yes/20 hover:bg-yes/90",
      no: "bg-no text-no-foreground shadow-lg shadow-no/20 hover:bg-no/90",
    };
    const sizes = {
      sm: "h-9 px-3 text-sm",
      md: "h-11 px-5 py-2",
      lg: "h-14 px-8 text-lg font-semibold",
      icon: "h-11 w-11 flex items-center justify-center p-0",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {isLoading ? (
          <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

// --- CARD ---
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card text-card-foreground shadow-xl shadow-black/10 overflow-hidden", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 flex flex-col space-y-1.5", className)} {...props}>{children}</div>;
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-xl font-display font-semibold leading-none tracking-tight", className)} {...props}>{children}</h3>;
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props}>{children}</div>;
}

// --- INPUT ---
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-12 w-full rounded-xl border border-border bg-background/50 px-4 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

// --- BADGE ---
export function Badge({ className, variant = "default", children }: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "success" | "warning" | "error" | "yes" | "no" | "outline" }) {
  const variants = {
    default: "bg-primary/10 text-primary border border-primary/20",
    success: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-500 border border-amber-500/20",
    error: "bg-destructive/10 text-destructive border border-destructive/20",
    yes: "bg-yes/10 text-yes border border-yes/20",
    no: "bg-no/10 text-no border border-no/20",
    outline: "bg-transparent text-muted-foreground border border-border",
  };
  return (
    <div className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-mono uppercase tracking-wider transition-colors", variants[variant], className)}>
      {children}
    </div>
  );
}

// --- DIALOG (Simplified Modal) ---
export function Modal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="z-50 w-full max-w-lg flex flex-col max-h-[90vh] scale-100 rounded-2xl bg-card border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex flex-col space-y-1.5 p-6 border-b border-border shrink-0">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// --- TABLE ---
export function Table({ className, children }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto rounded-xl border border-border bg-card">
      <table className={cn("w-full caption-bottom text-sm", className)}>{children}</table>
    </div>
  );
}
export function Th({ className, children }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0", className)}>{children}</th>;
}
export function Td({ className, children }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}>{children}</td>;
}

// --- PROBABILITY BAR ---
export function ProbabilityBar({ yesPrice, className }: { yesPrice: number, className?: string }) {
  const yesPct = Math.max(0, Math.min(100, yesPrice * 100));
  const noPct = 100 - yesPct;
  return (
    <div className={cn("h-2 w-full flex rounded-full overflow-hidden bg-muted", className)}>
      <div className="h-full bg-yes transition-all duration-500 ease-out" style={{ width: `${yesPct}%` }} />
      <div className="h-full bg-no transition-all duration-500 ease-out" style={{ width: `${noPct}%` }} />
    </div>
  );
}
