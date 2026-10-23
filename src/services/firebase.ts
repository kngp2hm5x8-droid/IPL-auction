import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const env = import.meta.env;
export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

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
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: env.VITE_FIREBASE_DATABASE_URL,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
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
