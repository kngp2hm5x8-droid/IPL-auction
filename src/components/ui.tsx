/**
 * Accessible UI primitives (shadcn-style: Tailwind + Radix primitives, owned in-repo).
 */
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Dialog as RDialog, Switch as RSwitch, Tabs as RTabs, Tooltip as RTooltip } from 'radix-ui';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Loader2, X, Inbox } from 'lucide-react';

export function cn(...c: ClassValue[]) {
  return twMerge(clsx(c));
}

/* ───────────── Button ───────────── */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-[0_8px_24px_-10px_rgb(245_184_65/0.7)] hover:from-gold-200 hover:to-gold-400 disabled:from-ink-600 disabled:to-ink-600 disabled:text-subtle disabled:shadow-none',
  secondary: 'bg-ink-700 text-fg hover:bg-ink-600 border border-white/8 disabled:opacity-50',
  outline: 'border border-white/12 text-fg hover:border-gold-400/60 hover:text-gold-300 disabled:opacity-50',
  ghost: 'text-muted hover:text-fg hover:bg-white/5 disabled:opacity-40',
  danger: 'bg-danger/12 text-red-300 border border-danger/30 hover:bg-danger/20 disabled:opacity-50',
  success: 'bg-success/14 text-emerald-300 border border-success/30 hover:bg-success/22 disabled:opacity-50',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
  xl: 'h-16 px-8 text-lg gap-3 rounded-2xl',
  icon: 'h-9 w-9 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      className={cn('inline-flex select-none items-center justify-center font-semibold whitespace-nowrap transition-[background,color,border-color,transform,box-shadow] duration-150 active:scale-[0.98] disabled:active:scale-100', VARIANTS[variant], SIZES[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ───────────── Surfaces ───────────── */

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface rounded-[var(--radius-card)]', className)} {...p} />;
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-white/6 px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold uppercase tracking-wide text-fg">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-400', className)}>{children}</div>;
}

export function Badge({ className, tone = 'neutral', children }: { className?: string; tone?: 'neutral' | 'gold' | 'success' | 'danger' | 'info' | 'warn'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-white/6 text-muted border-white/8',
    gold: 'bg-gold-400/12 text-gold-300 border-gold-400/30',
    success: 'bg-success/12 text-emerald-300 border-success/30',
    danger: 'bg-danger/12 text-red-300 border-danger/30',
    info: 'bg-info/12 text-sky-300 border-info/30',
    warn: 'bg-warn/12 text-amber-300 border-warn/30',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', tones[tone], className)}>{children}</span>;
}

/* ───────────── Forms ───────────── */

export function Field({ label, hint, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wider text-muted">{label}</label>
      {children}
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

const inputBase = 'w-full rounded-xl border border-white/10 bg-ink-900/80 px-3.5 text-sm text-fg placeholder:text-subtle transition-colors focus:border-gold-400/70 focus:outline-none focus:ring-2 focus:ring-gold-400/20 disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(inputBase, 'h-11', className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(inputBase, 'h-11 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27none%27 stroke=%27%2396a0b8%27 stroke-width=%272%27%3E%3Cpath d=%27M2 4l4 4 4-4%27/%3E%3C/svg%3E")] bg-[position:right_0.9rem_center] bg-no-repeat pr-9', className)} {...p}>
      {children}
    </select>
  );
});

export function Switch({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean; id: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description && <div className="text-xs text-muted">{description}</div>}
      </label>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative h-6 w-11 shrink-0 rounded-full border border-white/10 bg-ink-600 transition-colors data-[state=checked]:bg-gold-400 disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
      </RSwitch.Root>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; ariaLabel: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex flex-wrap gap-1 rounded-xl border border-white/8 bg-ink-900/70 p-1', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('min-w-10 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors', o.value === value ? 'bg-gold-400 text-ink-950' : 'text-muted hover:text-fg hover:bg-white/5')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Dialog ───────────── */

export function Dialog({ open, onOpenChange, title, description, children, className, footer }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; className?: string; footer?: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in" />
        <RDialog.Content className={cn('surface-strong fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl focus:outline-none', className)}>
          <div className="flex items-start justify-between gap-4 border-b border-white/6 px-5 py-4">
            <div>
              <RDialog.Title className="font-display text-2xl font-bold uppercase tracking-wide">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-sm text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">Dialog</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close"><X className="size-4" /></Button>
            </RDialog.Close>
          </div>
          <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/6 px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, danger, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: ReactNode; confirmLabel: string; onConfirm: () => void; danger?: boolean; loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
    />
  );
}

/* ───────────── Tabs ───────────── */

export const Tabs = RTabs.Root;
export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return <RTabs.List className={cn('scrollbar-thin flex gap-1 overflow-x-auto rounded-xl border border-white/8 bg-ink-900/70 p-1', className)}>{children}</RTabs.List>;
}
export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RTabs.Trigger value={value} className="whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:text-fg data-[state=active]:bg-ink-700 data-[state=active]:text-gold-300">
      {children}
    </RTabs.Trigger>
  );
}
export const TabsContent = RTabs.Content;

/* ───────────── Tooltip ───────────── */

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={200}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content sideOffset={6} className="z-50 max-w-60 rounded-lg border border-white/10 bg-ink-700 px-2.5 py-1.5 text-xs text-fg shadow-lg">
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

/* ───────────── States ───────────── */

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-3 py-10 text-sm text-muted', className)}>
      <Loader2 className="size-5 animate-spin text-gold-400" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <div className="mb-1 grid size-12 place-items-center rounded-2xl bg-white/5 text-muted">{icon ?? <Inbox className="size-5" />}</div>
      <div className="font-display text-xl font-semibold uppercase tracking-wide">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</div>
      <div className="tabular truncate font-display text-2xl font-bold leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
