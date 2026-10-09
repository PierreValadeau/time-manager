import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

function HomePage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ status: string }>('/health'),
  });

  const status = isPending ? 'chargement…' : isError ? 'injoignable' : data.status;

  return (
    <section className="card">
      <span className="card-kicker">État du service</span>
      <h2>API {status}</h2>
    </section>
  );
}

export default HomePage;
