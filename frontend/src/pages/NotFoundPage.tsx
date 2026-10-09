import { Link } from 'react-router';

function NotFoundPage() {
  return (
    <section className="card">
      <p className="text-muted">Cette page n’existe pas ou a été déplacée.</p>
      <p>
        <Link to="/">Retour à l’accueil</Link>
      </p>
    </section>
  );
}

export default NotFoundPage;
