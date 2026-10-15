import { usePageTitle } from '../lib/page-title';
import '../auth/guards.css';

// Placeholder target of the auth redirect; the login form comes with KAN-37
function LoginPage() {
  const title = usePageTitle();

  return (
    <main id="main" className="auth-screen">
      <h1>{title}</h1>
      <p className="text-muted">Le formulaire de connexion arrive bientôt.</p>
    </main>
  );
}

export default LoginPage;
