(function (root) {
  'use strict';
  let client;
  function config() {
    const value = root.CALEFICA_CONFIG;
    if (!value) throw new Error('Falta js/config.js. Copiá la plantilla de configuración.');
    const url = new URL(value.supabaseUrl);
    if (url.protocol !== 'https:' || !value.supabasePublishableKey?.startsWith('sb_publishable_')) {
      throw new Error('Revisá la URL y la clave publicable de Supabase.');
    }
    return value;
  }
  function getClient() {
    if (!client) {
      const value = config();
      if (!root.supabase?.createClient) throw new Error('No se pudo cargar el SDK de Supabase.');
      client = root.supabase.createClient(value.supabaseUrl, value.supabasePublishableKey, {
        auth: { storageKey: 'calefica_admin_session_v1', persistSession: true, autoRefreshToken: true,
          detectSessionInUrl: /\/admin\/recover\.html$/.test(root.location?.pathname || ''), flowType: 'implicit' },
      });
    }
    return client;
  }
  // El catálogo usa un cliente SIN sesión: un admin nunca ve ocultos por accidente.
  let publicClient;
  function getPublicClient() {
    if (!publicClient) {
      const value = config();
      if (!root.supabase?.createClient) throw new Error('No se pudo cargar el SDK de Supabase.');
      publicClient = root.supabase.createClient(value.supabaseUrl, value.supabasePublishableKey, {
        auth: { storageKey: 'calefica_public_v1', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
    return publicClient;
  }
  function unwrap(result) { if (result.error) throw result.error; return result.data; }
  root.CaleficaSupabase = Object.freeze({ getClient, getPublicClient, unwrap });
})(window);
