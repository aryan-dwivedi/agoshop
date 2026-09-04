import type { ReservedTab } from '../lib/demoPersonas';
import type { PublicUser } from '@shop/shared';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError, api } from '../lib/api';
import { DEMO_PASSWORD, DEMO_PERSONAS, reserveDashboardTab } from '../lib/demoPersonas';
import { useSession } from '../state/session';

const LOGIN_MESSAGES: Record<string, string> = {
    invalid_credentials: 'That email and password do not match an account.',
    rate_limited: 'Too many sign-in attempts from this address. Wait a minute and try again.',
    email_taken: 'That email is already registered — sign in instead.',
};
const Login = (): JSX.Element => {
    const { user, refresh } = useSession();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [params] = useSearchParams();
    const next = params.get('next') ?? '/';
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [form, setForm] = useState({
        email: '',
        password: '',
        displayName: '',
    });
    const pendingTab = useRef<ReservedTab | null>(null);
    const submit = useMutation({
        mutationFn: async (credentials: {
            email: string;
            password: string;
            displayName?: string;
        }) => {
            const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
            return api.post<{
                user: PublicUser;
            }>(path, credentials);
        },
        onSuccess: async () => {
            const landed = pendingTab.current?.show() ?? null;
            pendingTab.current = null;
            if (landed === 'self') return;
            queryClient.clear();
            await refresh();
            navigate(next);
        },
        onError: () => {
            pendingTab.current?.cancel();
            pendingTab.current = null;
        },
    });
    const error =
        submit.error === null
            ? null
            : submit.error instanceof ApiError
              ? (LOGIN_MESSAGES[submit.error.code] ??
                'That did not work. Check the email and password.')
              : 'Could not reach the sign-in service.';
    return (
        <div className="mx-auto w-full max-w-md space-y-4 py-4 md:py-6">
            <section className="card animate-fade-in overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                    <h1 className="text-23 font-semibold tracking-[-0.02em] text-t1">
                        {mode === 'login' ? 'Sign in' : 'Create an account'}
                    </h1>
                </div>

                <div className="p-5">
                    {user !== null && (
                        <p className="mb-4 rounded-ctl bg-surface px-3 py-2 text-14 text-t2">
                            Signed in as {user.displayName}.{' '}
                            <Link
                                to={next}
                                className="link font-medium"
                            >
                                Continue
                            </Link>
                        </p>
                    )}

                    <form
                        className="space-y-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            submit.mutate(
                                mode === 'register'
                                    ? form
                                    : { email: form.email, password: form.password },
                            );
                        }}
                    >
                        {mode === 'register' && (
                            <label className="block">
                                <span className="label">Name</span>
                                <input
                                    className="input"
                                    autoComplete="name"
                                    required
                                    value={form.displayName}
                                    onChange={(e) =>
                                        setForm({ ...form, displayName: e.target.value })
                                    }
                                />
                            </label>
                        )}

                        <label className="block">
                            <span className="label">Email</span>
                            <input
                                className="input"
                                type="email"
                                autoComplete="email"
                                required
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                            />
                        </label>

                        <label className="block">
                            <span className="label">Password</span>
                            <input
                                className="input"
                                type="password"
                                autoComplete={
                                    mode === 'login' ? 'current-password' : 'new-password'
                                }
                                required
                                minLength={8}
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                            />
                        </label>

                        {error !== null && (
                            <p
                                role="alert"
                                className="rounded-ctl bg-live-wash px-3 py-2 text-14 text-danger"
                            >
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            className="btn-commit btn-lg w-full"
                            disabled={submit.isPending}
                        >
                            {submit.isPending
                                ? 'Working…'
                                : mode === 'login'
                                  ? 'Sign in'
                                  : 'Create account and sign in'}
                        </button>
                    </form>

                    <button
                        type="button"
                        className="btn-quiet mt-3 px-0"
                        onClick={() => {
                            setMode(mode === 'login' ? 'register' : 'login');
                            submit.reset();
                        }}
                    >
                        {mode === 'login'
                            ? 'No account? Register instead'
                            : 'Already registered? Sign in instead'}
                    </button>
                </div>
            </section>

            <section className="card overflow-hidden">
                <div className="border-b border-line px-5 py-3">
                    <h2 className="section-title">Demo accounts</h2>
                </div>

                <div className="p-5">
                    <ul className="space-y-2">
                        {DEMO_PERSONAS.map((persona) => (
                            <li key={persona.email}>
                                <button
                                    type="button"
                                    className="w-full rounded-ctl border border-line px-3 py-3 text-left transition duration-ctl ease-out hover:border-line-ctl disabled:opacity-50"
                                    disabled={submit.isPending}
                                    onClick={() => {
                                        pendingTab.current = reserveDashboardTab(persona.dashboard);
                                        setMode('login');
                                        setForm({
                                            email: persona.email,
                                            password: DEMO_PASSWORD,
                                            displayName: '',
                                        });
                                        submit.mutate({
                                            email: persona.email,
                                            password: DEMO_PASSWORD,
                                        });
                                    }}
                                >
                                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                        <span className="text-14 font-medium text-t1">
                                            {persona.label}
                                        </span>
                                        <span className="text-13 text-t3">{persona.email}</span>
                                    </span>
                                    <span className="mt-1 block text-13 text-t2">
                                        {persona.blurb}
                                    </span>
                                    <span className="mt-1 block text-13 text-t3">
                                        {persona.dashboard === null
                                            ? 'Signs in here — the shopper journey'
                                            : 'Opens the Studio console in a new tab'}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>

                    <p className="mt-4 text-13 text-t3">
                        Every demo account uses the password{' '}
                        <span className="tnum">{DEMO_PASSWORD}</span>.
                    </p>
                </div>
            </section>
        </div>
    );
};
export default Login;
