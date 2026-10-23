import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { ClockIcon, WindowsLogoIcon } from '@phosphor-icons/react';
import { useAuth } from '../auth/auth-context';
import { LOGIN_PATH, type LoginLocationState } from '../auth/guards';
import { Alert, Button, RequiredFieldsNote, TextField } from '../components/ui';
import { ApiError } from '../lib/api';
import { APP_NAME, usePageTitle } from '../lib/page-title';
import '../auth/guards.css';
import './LoginPage.css';

// Full page navigation: the backend redirects to Microsoft, then back to the app (KAN-19)
export const MICROSOFT_LOGIN_URL = '/api/v1/auth/microsoft';
export const FORGOT_PASSWORD_PATH = '/mot-de-passe-oublie';

// Loose check, the backend has the final word
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = { email?: string; password?: string };

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email) {
    errors.email = 'Saisissez votre email.';
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = 'Saisissez un email valide, par exemple prenom.nom@trinity.market.';
  }
  if (!password) {
    errors.password = 'Saisissez votre mot de passe.';
  }
  return errors;
}

// Same message for an unknown email and a wrong password: the backend does not tell them apart
function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Email ou mot de passe incorrect.';
    if (error.status === 429) return 'Trop de tentatives de connexion. Réessayez dans quelques minutes.';
    if (error.status === 400) return 'Vérifiez votre email et votre mot de passe.';
  }
  return 'Connexion impossible pour le moment. Réessayez dans quelques instants.';
}

// Page requested before the redirect to login, home otherwise
function useRedirectTarget(): string {
  const state = useLocation().state as LoginLocationState | null;
  const from = state?.from;
  return from && from.startsWith('/') && !from.startsWith(LOGIN_PATH) ? from : '/';
}

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function useCurrentTime(): string {
  const [time, setTime] = useState(() => timeFormat.format(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setTime(timeFormat.format(new Date())), 1000);
    return () => clearInterval(timer);
  }, []);
  return time;
}

function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedEmail = email.trim();
    const errors = validate(trimmedEmail, password);
    setFieldErrors(errors);
    setFormError('');
    // Focus the first invalid field so its error is read out (WCAG 3.3.1)
    if (errors.email) {
      emailRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }

    setPending(true);
    try {
      // On success the page re-renders as signed in and redirects
      await login({ email: trimmedEmail, password });
    } catch (error) {
      setFormError(loginErrorMessage(error));
      setPassword('');
      passwordRef.current?.focus();
      setPending(false);
    }
  };

  return (
    <form className="login-form" noValidate onSubmit={handleSubmit}>
      <RequiredFieldsNote />
      <TextField
        ref={emailRef}
        label="Email professionnel"
        type="email"
        name="email"
        autoComplete="username"
        required
        value={email}
        error={fieldErrors.email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        ref={passwordRef}
        label="Mot de passe"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        error={fieldErrors.password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {/* Kept mounted so the message is announced when it appears */}
      <Alert tone="error">{formError}</Alert>
      <div className="login-actions">
        <Button type="submit" loading={pending}>
          Se connecter
        </Button>
        <Link to={FORGOT_PASSWORD_PATH} className="login-link">
          Mot de passe oublié ?
        </Link>
      </div>
    </form>
  );
}

function LoginPage() {
  const title = usePageTitle();
  const auth = useAuth();
  const redirectTo = useRedirectTarget();
  const time = useCurrentTime();

  if (auth.status === 'authenticated') {
    return <Navigate to={redirectTo} replace />;
  }

  if (auth.status === 'loading') {
    return (
      <div className="auth-screen" role="status">
        Chargement de votre session…
      </div>
    );
  }

  return (
    <div className="login-page">
      <main id="main" className="login-main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ClockIcon size={16} />
          </span>
          <span className="brand-name">{APP_NAME}</span>
        </div>

        <div className="login-intro">
          <h1>{title}</h1>
          <p className="text-muted">Utilisez votre compte Trinity Market. Les comptes sont créés par votre manager.</p>
        </div>

        <a href={MICROSOFT_LOGIN_URL} className="btn btn-secondary btn-block">
          <WindowsLogoIcon size={18} aria-hidden="true" />
          Se connecter avec Microsoft
        </a>

        <p className="login-separator">ou par email</p>

        <LoginForm />
      </main>

      {/* Decorative panel, hidden on small screens */}
      <div className="login-aside" aria-hidden="true">
        <p className="login-clock">{time}</p>
        <span className="login-rule" />
        <p className="login-tagline">
          Pointez en un geste. Vos heures sont comptées au plus juste, conformément au droit du travail.
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
