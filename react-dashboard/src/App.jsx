import { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient';

export default function App() {
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadGPS() {
      const { data: authData } =
        await supabase.auth.getUser();

      if (!authData.user) {
        setError('請先登入');
        return;
      }

      const { data, error } = await supabase
        .from('gps_logs')
        .select('latitude, longitude, recorded_at')
        .eq('user_id', authData.user.id)
        .order('recorded_at', { ascending: false })
        .limit(100);

      if (error) {
        setError(error.message);
      } else {
        setRecords(data ?? []);
      }
    }

    loadGPS();
  }, []);

  return (
    <main>
      <h1>DogTracker Dashboard</h1>
      {error && <p>{error}</p>}
      <p>GPS 筆數：{records.length}</p>

      {records.map((gps, i) => (
        <div key={i}>
          {gps.latitude}, {gps.longitude}
        </div>
      ))}
    </main>
  );
}