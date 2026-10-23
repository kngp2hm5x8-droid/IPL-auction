import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { useToasts } from '@/stores/toast';
import { cn } from './ui';

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? XCircle : Info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className={cn(
                'surface-strong pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm',
                t.kind === 'error' && 'border-danger/40',
                t.kind === 'success' && 'border-success/40',
              )}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', t.kind === 'error' ? 'text-danger' : t.kind === 'success' ? 'text-success' : 'text-info')} aria-hidden />
              <div className="flex-1 text-fg">{t.text}</div>
              <button onClick={() => dismiss(t.id)} className="text-subtle hover:text-fg" aria-label="Dismiss"><X className="size-4" /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
