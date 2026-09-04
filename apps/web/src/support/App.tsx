import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import { RoleGate } from '../components/seller/RoleGate';
import { SessionProvider } from '../state/session';

const Queue = lazy(() => import('../pages/support/Queue'));
const Loading = (): JSX.Element => (
    <div
        className="px-4 py-8"
        aria-busy="true"
    >
        <div className="skeleton h-6 w-48" />
    </div>
);
export const App = (): JSX.Element => (
    <SessionProvider>
        <RoleGate
            roles={['support', 'admin']}
            title="Support dashboard"
        >
            <Suspense fallback={<Loading />}>
                <Routes>
                    <Route
                        path="/"
                        element={<Queue />}
                    />
                </Routes>
            </Suspense>
        </RoleGate>
    </SessionProvider>
);
