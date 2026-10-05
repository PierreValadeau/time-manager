import { useEffect, useState } from 'react';

function App() {
  const [status, setStatus] = useState('chargement...');

  useEffect(() => {
    fetch('/api/v1/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('backend injoignable'));
  }, []);

  return <h1>Time Manager : API {status}</h1>;
}

export default App;