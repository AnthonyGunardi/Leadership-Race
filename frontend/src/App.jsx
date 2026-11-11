import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { AdminAccess } from './components/AdminAccess.jsx';
import { DisplayBoardPage } from './pages/DisplayBoardPage.jsx';
import { DisplayFinalPage } from './pages/DisplayFinalPage.jsx';
import { DisplayLeaderboardPage } from './pages/DisplayLeaderboardPage.jsx';
import './app.css';

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

/**
 * Root Application component providing Routing and React Query contexts.
 *
 * @param {object} [props={}] Component properties.
 * @param {QueryClient} [props.queryClient=defaultQueryClient] Optional QueryClient for tests.
 * @returns {import('react').ReactElement}
 */
export function App({ queryClient = defaultQueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DisplayBoardPage />} />
          <Route path="/final" element={<DisplayFinalPage />} />
          <Route path="/leaderboard" element={<DisplayLeaderboardPage />} />
          <Route path="/login" element={<AdminAccess />} />
          <Route path="/admin/*" element={<AdminAccess />} />
          <Route path="/display/:id/*" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
