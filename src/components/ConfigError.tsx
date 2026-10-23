import { TriangleAlert } from 'lucide-react';
import { Card } from './ui';
import { Brand } from './Brand';

export function ConfigError({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4">
      <Brand />
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <div>
            <h1 className="font-display text-2xl font-bold uppercase">Setup needed</h1>
            <p className="mt-2 text-sm text-muted">{message}</p>
            <p className="mt-3 text-sm text-muted">For local play without a Firebase project, run <code className="rounded bg-ink-700 px-1.5 py-0.5 text-gold-300">npm run emulators</code> and <code className="rounded bg-ink-700 px-1.5 py-0.5 text-gold-300">npm run dev:emu</code>.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
