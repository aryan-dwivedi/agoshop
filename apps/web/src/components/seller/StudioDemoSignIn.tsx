import type { Role } from '@shop/shared';

import { useState } from 'react';

import { ApiError } from '../../lib/api';
import { demoPersonasForRole, signInWithDemoAccount } from '../../lib/demoPersonas';

export const StudioDemoSignIn = ({
    roles,
    currentRole,
}: {
    roles: Role[];
    currentRole: Role | null;
}): JSX.Element | null => {
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const offered = roles.includes('seller') || roles.includes('support');
    if (!offered) return null;
    const demoRole: Role = roles.includes('support') ? 'support' : 'seller';
    const personas = demoPersonasForRole(demoRole);
    const signInAs = async (email: string): Promise<void> => {
        setPending(email);
        setError(null);
        try {
            await signInWithDemoAccount(email, { logoutFirst: currentRole !== null });
            window.location.reload();
        } catch (err) {
            const message =
                err instanceof ApiError && err.code === 'invalid_credentials'
                    ? 'That email and password do not match an account. Run npm run db:seed if this is a fresh database.'
                    : err instanceof ApiError && err.code === 'session_not_switched'
                      ? err.message
                      : err instanceof ApiError && err.code === 'rate_limited'
                        ? 'Too many sign-in attempts. Wait a minute and try again.'
                        : `Could not sign in as ${email}.`;
            setError(message);
            setPending(null);
        }
    };
    return (
        <div className="mt-5 flex flex-col gap-2">
            {personas.map((persona, index) => (
                <button
                    key={persona.email}
                    type="button"
                    className={index === 0 ? 'btn-commit' : 'btn-standard'}
                    disabled={pending !== null}
                    onClick={() => void signInAs(persona.email)}
                >
                    {pending === persona.email ? 'Signing in…' : `Sign in as ${persona.email}`}
                </button>
            ))}
            {error !== null && <p className="field-error mt-1">{error}</p>}
        </div>
    );
};
