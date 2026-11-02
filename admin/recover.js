(function () {
  'use strict';
  const service = window.CaleficaRecoveryService;
  const $ = selector => document.querySelector(selector);
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const fromRecoveryLink = fragment.get('type') === 'recovery';
  let verified = false, validating = false, busy = false, completed = false;
  function status(text, error = false) {
    $('#recovery-status').textContent = text;
    $('#recovery-status').classList.toggle('error', error);
  }
  function errorMessage(error) {
    if (error.status === 429 || /rate_limit/.test(error.code || '')) return 'Se alcanzó el límite de envíos. Esperá antes de solicitar otro enlace.';
    if (/smtp|email_address_not_authorized|email.*sending/i.test(error.code || '') || error.status === 500) return 'Supabase no pudo enviar el email. Revisá la configuración de correo del proyecto.';
    if (error.code === 'same_password') return 'Elegí una contraseña diferente de la actual.';
    return error.message || 'No se pudo completar la operación.';
  }
  async function verify() {
    if (validating || verified || completed) return;
    validating = true; $('#request-form').hidden = true;
    status('Validando enlace…');
    try {
      await service.recoveryUser();
      verified = true;
      $('#recovery-title').textContent = 'Elegí una nueva clave.';
      $('#recovery-copy').textContent = 'Usá al menos 12 caracteres. La nueva contraseña reemplazará la anterior de tu usuario.';
      $('#password-form').hidden = false;
      status('Enlace validado.');
      $('#password-form').elements.password.focus();
    } catch (error) {
      $('#request-form').hidden = false;
      status(errorMessage(error), true);
    } finally { validating = false; }
  }
  async function operation(form, action) {
    if (busy) return;
    busy = true;
    const controls = [...form.querySelectorAll('input,button')];
    controls.forEach(element => { element.disabled = true; });
    try { await action(); } catch (error) { status(errorMessage(error), true); }
    finally { busy = false; controls.forEach(element => { element.disabled = false; }); }
  }
  $('#request-form').addEventListener('submit', event => {
    event.preventDefault();
    const email = event.target.elements.email.value;
    operation(event.target, async () => {
      status('Solicitando enlace…');
      await service.request(email);
      status('Si el email corresponde a una cuenta, recibirás un enlace. Revisá también Spam y abrilo en este equipo.');
    });
  });
  $('#password-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!verified) return status('Primero abrí un enlace de recuperación válido.', true);
    const password = event.target.elements.password.value;
    const confirmation = event.target.elements.confirmation.value;
    operation(event.target, async () => {
      status('Guardando contraseña…');
      await service.change(password, confirmation);
      completed = true; verified = false;
      event.target.reset(); event.target.hidden = true;
      $('#recovery-title').textContent = 'Tu nueva clave está lista.';
      $('#recovery-copy').textContent = 'Volvé al ingreso y usá tu email con la contraseña que acabás de elegir.';
      try { await service.closeSession(); status('Contraseña guardada. Ya podés volver a ingresar.'); }
      catch { status('Contraseña guardada. No se pudo cerrar la sesión de recuperación; cerrá esta pestaña antes de volver al ingreso.'); }
    });
  });
  $('#show-password').addEventListener('change', event => {
    for (const name of ['password', 'confirmation']) $('#password-form').elements[name].type = event.target.checked ? 'text' : 'password';
  });
  try {
    service.onAuthChange(event => {
      if (event === 'PASSWORD_RECOVERY') setTimeout(verify, 0);
      if (event === 'SIGNED_OUT' && !completed) setTimeout(() => {
        verified = false; $('#password-form').reset(); $('#password-form').hidden = true;
        $('#request-form').hidden = false; status('La sesión venció. Solicitá un enlace nuevo.', true);
      }, 0);
    });
    if (fromRecoveryLink) verify();
    else if (fragment.has('error') || new URLSearchParams(location.search).has('error')) status('El enlace venció o no es válido. Solicitá uno nuevo.', true);
  } catch (error) { status(errorMessage(error), true); }
})();
