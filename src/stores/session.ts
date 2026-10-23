import { create } from 'zustand';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth, configured } from '@/services/firebase';

const NAME_KEY = 'ipl.displayName';

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

interface SessionState {
  uid: string | null;
  ready: boolean;
  error: string | null;
  displayName: string;
  setDisplayName: (n: string) => void;
}

export const useSession = create<SessionState>((set) => ({
  uid: null,
  ready: false,
  error: configured ? null : 'Firebase is not configured. Copy .env.example to .env.local and fill in your project settings.',
  displayName: readName(),
  setDisplayName: (n) => {
    try { localStorage.setItem(NAME_KEY, n); } catch { /* storage unavailable */ }
    set({ displayName: n });
  },
}));

/** Anonymous guest auth. Firebase persists the identity (IndexedDB) across refreshes. */
export function startAuth() {
  if (!configured) {
    useSession.setState({ ready: true });
    return;
  }
  onAuthStateChanged(auth, (user) => {
    if (user) {
      useSession.setState({ uid: user.uid, ready: true, error: null });
    } else {
      signInAnonymously(auth).catch((e) => useSession.setState({ ready: true, error: `Could not sign in: ${e.message}` }));
    }
  });
}
