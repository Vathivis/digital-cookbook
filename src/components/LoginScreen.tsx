import { useState } from 'react';
import type { FormEvent } from 'react';
import { login } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface Props {
	onSuccess: () => Promise<void> | void;
}

const asMessage = (error: unknown) => {
	if (error instanceof Error && error.message) return error.message;
	return 'Login failed';
};

export function LoginScreen({ onSuccess }: Props) {
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [rememberPermanently, setRememberPermanently] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await login({ username, password, rememberPermanently });
			setPassword('');
			await onSuccess();
		} catch (err) {
			setError(asMessage(err));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="min-h-screen app-bg flex items-center justify-center p-6">
			<div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm surface-transition">
				<h1 className="text-2xl font-semibold">Sign in</h1>
				<p className="mt-1 text-sm text-muted-foreground">Use the shared credentials from your environment config.</p>
				<form onSubmit={submit} className="mt-6 flex flex-col gap-4">
					<div className="space-y-2">
						<Label htmlFor="login-username">Username</Label>
						<Input
							id="login-username"
							name="username"
							autoComplete="username"
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							required
							disabled={submitting}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="login-password">Password</Label>
						<Input
							id="login-password"
							type="password"
							name="password"
							autoComplete="current-password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							required
							disabled={submitting}
						/>
					</div>
					<label className="flex items-center gap-2 text-sm text-muted-foreground">
						<input
							type="checkbox"
							checked={rememberPermanently}
							onChange={(event) => setRememberPermanently(event.target.checked)}
							disabled={submitting}
						/>
						Remember login permanently
					</label>
					{error && <p className="text-sm text-destructive">{error}</p>}
					<Button type="submit" disabled={submitting} className="w-full">
						{submitting ? 'Signing in...' : 'Sign in'}
					</Button>
				</form>
			</div>
		</div>
	);
}
