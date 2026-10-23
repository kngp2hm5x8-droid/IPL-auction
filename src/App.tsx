import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/Toaster';
import { Spinner } from './components/ui';
import { HomePage } from './pages/HomePage';
import { CreateRoomPage } from './pages/CreateRoomPage';
import { JoinRoomPage } from './pages/JoinRoomPage';
import { RoomLayout, RoomIndex } from './features/rooms/RoomLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import { useSession } from './stores/session';
import { ConfigError } from './components/ConfigError';
import { ErrorBoundary } from './components/ErrorBoundary';

const LobbyPage = lazy(() => import('./features/rooms/LobbyPage'));
const AuctionPage = lazy(() => import('./features/auction/AuctionPage'));
const PlayerPoolPage = lazy(() => import('./features/players/PlayerPoolPage'));
const SquadPage = lazy(() => import('./features/squads/SquadPage'));
const XIBuilderPage = lazy(() => import('./features/squads/XIBuilderPage'));
const TournamentPage = lazy(() => import('./features/tournament/TournamentPage'));
const MatchPage = lazy(() => import('./features/matches/MatchPage'));

export function App() {
  const { ready, error } = useSession();
  return (
    <BrowserRouter>
      <Toaster />
      {error ? (
        <ConfigError message={error} />
      ) : !ready ? (
        <Spinner label="Signing you in…" className="min-h-dvh" />
      ) : (
        <ErrorBoundary>
        <Suspense fallback={<Spinner className="min-h-[50dvh]" />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/create" element={<CreateRoomPage />} />
            <Route path="/join" element={<JoinRoomPage />} />
            <Route path="/join/:code" element={<JoinRoomPage />} />
            <Route path="/room/:code" element={<RoomLayout />}>
              <Route index element={<RoomIndex />} />
              <Route path="lobby" element={<LobbyPage />} />
              <Route path="auction" element={<AuctionPage />} />
              <Route path="players" element={<PlayerPoolPage />} />
              <Route path="squad" element={<SquadPage />} />
              <Route path="squad/:teamId" element={<SquadPage />} />
              <Route path="xi" element={<XIBuilderPage />} />
              <Route path="tournament" element={<TournamentPage />} />
              <Route path="match/:fixtureId" element={<MatchPage />} />
              <Route path="*" element={<Navigate to="." replace />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      )}
    </BrowserRouter>
  );
}
