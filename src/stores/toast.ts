import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem { id: number; kind: ToastKind; text: string }

interface ToastState {
  items: ToastItem[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
}

let next = 1;
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (kind, text) => {
    const id = next++;
    set({ items: [...get().items.slice(-3), { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 5000 : 3200);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (t: string) => useToasts.getState().push('success', t),
  error: (t: string) => useToasts.getState().push('error', t),
  info: (t: string) => useToasts.getState().push('info', t),
};
