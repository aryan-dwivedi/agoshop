import type { SellerRef } from '../../lib/sellerApi';
import type { PublicUser, Role } from '@shop/shared';
import type { ReactNode } from 'react';

import { useState } from 'react';

import { api } from '../../lib/api';
import { DEMO_PASSWORD, demoPersona } from '../../lib/demoPersonas';
import { useSession } from '../../state/session';
import { ShieldIcon } from '../icons';

const Denied = ({ roles, current }: { roles: Role[]; current: Role | null }): JSX.Element => {
    const { applyUser } = useSession();
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const offered = roles.includes('seller') || roles.includes('support');
    const demoRole: Role = roles.includes('support') ? 'support' : 'seller';
    const signInAs = async (): Promise<void> => {
        const { email } = demoPersona(demoRole);
        setPending(demoRole);
        setError(null);
        try {
            const { user } = await api.post<{ user: PublicUser }>('/api/auth/login', {
                email,
                password: DEMO_PASSWORD,
            });
            applyUser(user);
        } catch {
            setError(`Could not sign in as ${email}.`);
        } finally {
            setPending(null);
        }
    };
    return (
        <div className="studio-empty mx-auto mt-16 max-w-md animate-slide-up">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-wash text-accent">
                <ShieldIcon className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-19 font-semibold text-t1">Studio access required</h1>
            <p className="mx-auto mt-2 max-w-sm text-14 leading-relaxed text-t2">
                {current === null
                    ? 'Sign in with a seller account to continue.'
                    : `This ${current} account does not have access to the seller panel.`}
            </p>
            {offered && (
                <button
                    type="button"
                    className="btn-commit mt-5"
                    disabled={pending !== null}
                    onClick={() => void signInAs()}
                >
                    {pending === demoRole
                        ? 'Signing in…'
                        : `Sign in as ${demoPersona(demoRole).email}`}
                </button>
            )}
            {error !== null && <p className="field-error mt-3">{error}</p>}
        </div>
    );
};

export const RoleGate = ({
    roles,
    title,
    subtitle,
    actions,
    scope,
    theme = 'light',
    children,
}: {
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
    const frame = (body: ReactNode): JSX.Element => (
        <div
            data-theme={theme}
            className="studio-page min-h-full bg-bg text-t1"
        >
            {body}
        </div>
    );
    if (loading) {
        return frame(
            <div
                className="mt-16 space-y-3"
                aria-busy="true"
                aria-label="Checking your session"
            >
                <div className="skeleton h-7 w-48" />
                <div className="skeleton h-4 w-72" />
                <div className="skeleton mt-4 h-40 w-full rounded-panel" />
            </div>,
        );
    }
    if (user === null || !roles.includes(user.role)) {
        return frame(
            <Denied
                roles={roles}
                current={user?.role ?? null}
            />,
        );
    }
    return frame(
        <>
            <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="font-display text-28 font-semibold tracking-[-0.02em] text-t1">
                        {title}
                    </h1>
                    {subtitle !== undefined && (
                        <p className="mt-1 max-w-2xl text-14 leading-relaxed text-t2">{subtitle}</p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {scope !== undefined && scope.sellers.length > 1 && (
                        <label className="flex items-center gap-2 text-13 font-medium text-t2">
                            Storefront
                            <select
                                className="input-studio w-auto min-w-[140px]"
                                value={scope.value ?? ''}
                                onChange={(e) =>
                                    scope.onChange(e.target.value === '' ? null : e.target.value)
                                }
                            >
                                <option value="">
                                    {scope.allLabel ?? `All (${scope.sellers.length})`}
                                </option>
                                {scope.sellers.map((seller) => (
                                    <option
                                        key={seller.id}
                                        value={seller.id}
                                    >
                                        {seller.displayName}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    {actions}
                </div>
            </header>
            {children}
        </>,
    );
};
