import { useState, type ReactNode } from 'react';
import type { Role } from '@shop/shared';
import { api } from '../../lib/api';
import { DEMO_PASSWORD, demoPersona } from '../../lib/demoPersonas';
import type { SellerRef } from '../../lib/sellerApi';
import { useSession } from '../../state/session';
import { ShieldIcon } from '../icons';
const Denied = ({ roles, current }: {
    roles: Role[];
    current: Role | null;
}): JSX.Element => {
    const { refresh } = useSession();
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const offered = roles.includes('seller') || roles.includes('support');
    const demoRole: Role = roles.includes('support') ? 'support' : 'seller';
    const signInAs = async (): Promise<void> => {
        const { email } = demoPersona(demoRole);
        setPending(demoRole);
        setError(null);
        try {
            await api.post('/api/auth/login', { email, password: DEMO_PASSWORD });
            await refresh();
        }
        catch {
            setError(`Could not sign in as ${email}.`);
        }
        finally {
            setPending(null);
        }
    };
    return (<div className="card animate-slide-up mx-auto mt-12 max-w-lg p-5 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent-wash text-accent">
        <ShieldIcon className="h-5 w-5"/>
      </span>
      <h1 className="mt-3 text-19 font-semibold text-t1">Studio access required</h1>
      <p className="mx-auto mt-1.5 max-w-md text-13 leading-relaxed text-t2">
        {current === null
            ? 'Sign in with a seller account to continue.'
            : `This ${current} account does not have access to the seller panel.`}
      </p>
      {offered && (<div className="mt-4 flex justify-center">
          <button type="button" className="btn-commit" disabled={pending !== null} onClick={() => void signInAs()}>
            {pending === demoRole ? 'Signing in…' : `Sign in as ${demoPersona(demoRole).email}`}
          </button>
        </div>)}
      {error !== null && <p className="field-error mt-3">{error}</p>}
    </div>);
};
export const RoleGate = ({ roles, title, subtitle, actions, scope, theme = 'light', children, }: {
    roles: Role[];
    title: string;
    subtitle?: string;
    actions?: ReactNode;
    scope?: {
        sellers: SellerRef[];
        value: string | null;
        allLabel?: string;
        onChange: (sellerId: string | null) => void;
    };
    theme?: 'dark' | 'light';
    children: ReactNode;
}): JSX.Element => {
    const { user, loading } = useSession();
    const frame = (body: ReactNode): JSX.Element => (<div data-theme={theme} className="min-h-full bg-bg px-4 py-3 text-t1">
      {body}
    </div>);
    if (loading) {
        return frame(<div className="mt-12 space-y-2" aria-busy="true" aria-label="Checking your session">
        <div className="skeleton mx-auto h-5 w-48"/>
        <div className="skeleton mx-auto h-4 w-64"/>
      </div>);
    }
    if (user === null || !roles.includes(user.role)) {
        return frame(<Denied roles={roles} current={user?.role ?? null}/>);
    }
    return frame(<>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <h1 className="text-23 font-semibold tracking-[-0.01em] text-t1">{title}</h1>
          {subtitle !== undefined && (<p className="mt-0.5 max-w-2xl text-13 leading-relaxed text-t2">{subtitle}</p>)}
        </div>
        <div className="flex items-center gap-2">
          {scope !== undefined && scope.sellers.length > 1 && (<label className="flex items-center gap-2 text-13 font-medium text-t2">
              Storefront
              <select className="input w-auto" value={scope.value ?? ''} onChange={(e) => scope.onChange(e.target.value === '' ? null : e.target.value)}>
                <option value="">{scope.allLabel ?? `All (${scope.sellers.length})`}</option>
                {scope.sellers.map((seller) => (<option key={seller.id} value={seller.id}>
                    {seller.displayName}
                  </option>))}
              </select>
            </label>)}
          {actions}
        </div>
      </header>

      {children}
    </>);
};
