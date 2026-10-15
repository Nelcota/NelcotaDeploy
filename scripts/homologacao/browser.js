// Cole no console da origem HTTPS do painel. Não é um frontend de produção.
// Tokens, convites, otpauth e recovery codes aparecem apenas em diálogos locais.
(() => {
  if (location.protocol !== 'https:') throw new Error('Abra a origem HTTPS do painel.');
  let csrf = '';
  const decode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const encode = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const creation = json => {
    if (PublicKeyCredential.parseCreationOptionsFromJSON) return PublicKeyCredential.parseCreationOptionsFromJSON(json);
    const p = structuredClone(json);
    p.challenge = decode(p.challenge);
    p.user.id = decode(p.user.id);
    for (const c of p.excludeCredentials || []) c.id = decode(c.id);
    return p;
  };
  const assertion = json => {
    if (PublicKeyCredential.parseRequestOptionsFromJSON) return PublicKeyCredential.parseRequestOptionsFromJSON(json);
    const p = structuredClone(json);
    p.challenge = decode(p.challenge);
    for (const c of p.allowCredentials || []) c.id = decode(c.id);
    return p;
  };
  const serialize = c => {
    if (c.toJSON) return c.toJSON();
    const r = c.response;
    const response = {clientDataJSON: encode(r.clientDataJSON)};
    if (r.attestationObject) {
      response.attestationObject = encode(r.attestationObject);
      response.transports = r.getTransports ? r.getTransports() : [];
    } else {
      response.authenticatorData = encode(r.authenticatorData);
      response.signature = encode(r.signature);
      response.userHandle = r.userHandle ? encode(r.userHandle) : null;
    }
    return {id: c.id, rawId: encode(c.rawId), type: c.type, response, clientExtensionResults: c.getClientExtensionResults()};
  };
  async function api(path, method = 'GET', body) {
    if (!path.startsWith('/api/')) throw new Error('Use um caminho /api/ da mesma origem.');
    const headers = {'Content-Type': 'application/json'};
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(path, {method, headers, credentials: 'same-origin', cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body)});
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`${res.status}: ${data.code || 'error'} ${data.message || ''}`);
    }
    return data;
  }
  window.N = {
    api,
    async register() {
      const token = prompt('Convite de /etc/nelcota/first-access.json (15 min):');
      if (!token) throw new Error('Convite não informado.');
      const begin = await api('/api/auth/register/begin', 'POST', {enrollment_token: token.trim()});
      const credential = await navigator.credentials.create({publicKey: creation(begin.options.publicKey)});
      await api('/api/auth/register/finish', 'POST', {ceremony_id: begin.ceremony_id, credential: serialize(credential)});
    },
    async login() {
      // Preserve a known CSRF value for a revoked cookie until login replaces
      // that cookie. A valid existing session can also refresh this value.
      try { csrf = (await api('/api/session')).csrf_token; }
      catch (e) { if (!e.message.startsWith('401:')) throw e; }
      const email = prompt('E-mail do administrador:');
      if (!email) throw new Error('E-mail não informado.');
      const begin = await api('/api/auth/login/begin', 'POST', {email: email.trim()});
      const credential = await navigator.credentials.get({publicKey: assertion(begin.options.publicKey)});
      const result = await api('/api/auth/login/finish', 'POST', {ceremony_id: begin.ceremony_id, credential: serialize(credential)});
      if (result.requires_totp) {
        const code = prompt('TOTP atual, ou recovery code de uso único:');
        if (!code) throw new Error('Código não informado; refaça o login.');
        const recovery = code.trim().replace(/-/g, '').length === 32;
        await api(recovery ? '/api/auth/recovery/verify' : '/api/auth/totp/verify', 'POST', {challenge: result.challenge, code: code.trim()});
      }
      csrf = (await api('/api/session')).csrf_token;
    },
    async enableTOTP() {
      const setup = await api('/api/auth/totp/begin', 'POST', {});
      prompt('Cadastre esta URL otpauth no autenticador; não a compartilhe:', setup.url);
      const code = prompt('Código TOTP recém-gerado:');
      if (!code) throw new Error('Código não informado.');
      await api('/api/auth/totp/finish', 'POST', {id: setup.id, code: code.trim()});
    },
    async recoveryCodes() {
      const result = await api('/api/auth/recovery-codes', 'POST', {});
      prompt('Guarde estes dez códigos em cofre privado. Nova geração invalida os anteriores:', result.codes.join('\n'));
    },
    async makeToken() {
      const result = await api('/api/tokens', 'POST', {name: 'homologacao', ttl_hours: 1,
        scopes: ['apps:write', 'deploys:write', 'servers:write', 'logs:read', 'settings:write', 'audit:read']});
      N.tokenId = result.id;
      prompt('Copie o token para a leitura oculta do terminal. Expira em 1 hora:', result.token);
      result.token = '';
    },
    async revokeToken() {
      if (!N.tokenId) throw new Error('Consulte GET /api/tokens e informe N.tokenId.');
      await api(`/api/tokens/${encodeURIComponent(N.tokenId)}`, 'DELETE');
    },
    async githubManifest() {
      const result = await api('/api/github/manifest', 'POST', {});
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = result.action;
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'manifest'; input.value = JSON.stringify(result.manifest);
      form.append(input); document.body.append(form); form.submit();
    },
    async logout() {
      await api('/api/auth/logout', 'POST');
      csrf = '';
    }
  };
})();
