(function (root) {
  'use strict';
  const client = () => root.CaleficaSupabase.getClient();
  const unwrap = result => root.CaleficaSupabase.unwrap(result);
  async function request(email) {
    const redirectTo = new URL('recover.html', root.location.href);
    redirectTo.hash = ''; redirectTo.search = '';
    unwrap(await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo.href }));
  }
  async function recoveryUser() {
    const result = await client().auth.getUser();
    if (result.error || !result.data.user) throw new Error('El enlace venció o no es válido. Solicitá uno nuevo.');
    return result.data.user;
  }
  async function change(password, confirmation) {
    if (password.length < 12) throw new Error('Elegí una contraseña de al menos 12 caracteres.');
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
    await recoveryUser();
    unwrap(await client().auth.updateUser({ password }));
  }
  async function closeSession() { unwrap(await client().auth.signOut({ scope: 'local' })); }
  root.CaleficaRecoveryService = Object.freeze({ request, recoveryUser, change, closeSession,
    onAuthChange: callback => client().auth.onAuthStateChange(callback) });
})(window);
