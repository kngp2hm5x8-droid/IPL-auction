import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const env = import.meta.env;
export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

/**
 * Web config for the project this app is deployed with. Firebase web config is PUBLIC by design
 * (every visitor's browser receives it); security comes from Auth, the database rules and the
 * server. Building it in means a missing or mangled VITE_FIREBASE_* variable on the host can't
 * break sign-in. Set the VITE_FIREBASE_* variables to point the app at a different project.
 */
const PROJECT_DEFAULTS = {
  apiKey: 'AIzaSyCKj3WzL5aC1qSaukjMfIIVX8C8EH__8Xg',
  authDomain: 'ipl-auction-fa6d2.firebaseapp.com',
  databaseURL: 'https://ipl-auction-fa6d2-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'ipl-auction-fa6d2',
  appId: '1:31605975349:web:ebb35eb4adf77c779d847c',
};

/** Uses the env value only if it is well-formed (e.g. not a masked "AIza…••••" copy). */
function pick(value: string | undefined, fallback: string, shape: RegExp): string {
  const v = value?.trim();
  if (v && shape.test(v)) return v;
  if (v) console.warn('Ignoring malformed Firebase setting; using the built-in project config.');
  return fallback;
}

const emulatorProject = env.VITE_EMULATOR_PROJECT_ID || 'demo-ipl-auction';
const config = usingEmulators
  ? {
      apiKey: 'demo-key',
      authDomain: `${emulatorProject}.firebaseapp.com`,
      projectId: emulatorProject,
      databaseURL: `https://${emulatorProject}-default-rtdb.firebaseio.com`,
      appId: 'demo-app',
    }
  : {
      apiKey: pick(env.VITE_FIREBASE_API_KEY, PROJECT_DEFAULTS.apiKey, /^AIza[0-9A-Za-z_-]{35}$/),
      authDomain: pick(env.VITE_FIREBASE_AUTH_DOMAIN, PROJECT_DEFAULTS.authDomain, /^[a-z0-9.-]+$/),
      databaseURL: pick(env.VITE_FIREBASE_DATABASE_URL, PROJECT_DEFAULTS.databaseURL, /^https:\/\/[a-z0-9.-]+\/?$/),
      projectId: pick(env.VITE_FIREBASE_PROJECT_ID, PROJECT_DEFAULTS.projectId, /^[a-z0-9-]+$/),
      appId: pick(env.VITE_FIREBASE_APP_ID, PROJECT_DEFAULTS.appId, /^[0-9]+:[0-9]+:web:[0-9a-f]+$/),
    };

export const configured = usingEmulators || Boolean(config.apiKey && config.databaseURL && config.projectId);

export const app = initializeApp(configured ? config : { apiKey: 'missing', projectId: 'missing', databaseURL: 'https://missing.firebaseio.com' });
export const auth = getAuth(app);
export const db = getDatabase(app);
export const functions = getFunctions(app, env.VITE_FUNCTIONS_REGION || 'asia-southeast1');

if (usingEmulators) {
  const host = env.VITE_EMULATOR_HOST || window.location.hostname || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(db, host, 9000);
  connectFunctionsEmulator(functions, host, 5001);
}
