import { Link } from 'react-router-dom';

import { customerUrl } from '../../lib/origins';

export const HostLoading = (): JSX.Element => (
  <div
    data-surface="studio"
    data-room="broadcast"
    className="flex h-[100dvh] flex-col gap-2 bg-bg p-3"
  >
    <div className="skeleton h-12 w-full" />
    <div className="skeleton min-h-0 flex-1" />
    <div className="skeleton h-16 w-full" />
  </div>
);

export const HostLoadError = ({ message }: { message?: string }): JSX.Element => (
  <div
    data-surface="studio"
    data-room="broadcast"
    className="flex h-[100dvh] items-center justify-center bg-bg p-6"
  >
    <div className="card max-w-md p-6 text-center">
      <p className="text-16 font-semibold text-t1">This show could not be loaded.</p>
      <p className="mt-1 text-14 text-t2">{message}</p>
      <Link to="/shows" className="btn-standard mt-4">
        Back to shows
      </Link>
    </div>
  </div>
);

export const HostRoleGate = ({ slug }: { slug: string }): JSX.Element => (
  <div
    data-surface="studio"
    data-room="broadcast"
    className="flex h-[100dvh] items-center justify-center bg-bg p-6"
  >
    <div className="card max-w-md p-6 text-center">
      <p className="text-16 font-semibold text-t1">The broadcast room is for sellers and invited co-hosts.</p>
      <p className="mt-1 text-14 text-t2">Sign in with a seller account, or accept a co-host invite from the host.</p>
      <a href={customerUrl(`/live/${slug}`)} className="btn-standard mt-4">
        Watch as a shopper
      </a>
    </div>
  </div>
);
