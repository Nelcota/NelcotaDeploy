// Paste into the panel HTTPS origin console. This is not a production frontend.
// Tokens, invitations, otpauth URLs, and recovery codes only appear in local dialogs.
(() => {
  if (location.protocol !== 'https:') throw new Error('Open the panel HTTPS origin.');
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
    if (!path.startsWith('/api/')) throw new Error('Use a same-origin /api/ path.');
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
      const token = prompt('Invitation from /etc/nelcota/first-access.json (15 minutes):');
      if (!token) throw new Error('Invitation not provided.');
      const begin = await api('/api/auth/register/begin', 'POST', {enrollment_token: token.trim()});
      const credential = await navigator.credentials.create({publicKey: creation(begin.options.publicKey)});
      await api('/api/auth/register/finish', 'POST', {ceremony_id: begin.ceremony_id, credential: serialize(credential)});
    },
    async login() {
      // Preserve a known CSRF value for a revoked cookie until login replaces
      // that cookie. A valid existing session can also refresh this value.
      try { csrf = (await api('/api/session')).csrf_token; }
      catch (e) { if (!e.message.startsWith('401:')) throw e; }
      const email = prompt('Administrator email:');
      if (!email) throw new Error('Email address not provided.');
      const begin = await api('/api/auth/login/begin', 'POST', {email: email.trim()});
      const credential = await navigator.credentials.get({publicKey: assertion(begin.options.publicKey)});
      const result = await api('/api/auth/login/finish', 'POST', {ceremony_id: begin.ceremony_id, credential: serialize(credential)});
      if (result.requires_totp) {
        const code = prompt('Current TOTP or single-use recovery code:');
        if (!code) throw new Error('Code not provided; sign in again.');
        const recovery = code.trim().replace(/-/g, '').length === 32;
        await api(recovery ? '/api/auth/recovery/verify' : '/api/auth/totp/verify', 'POST', {challenge: result.challenge, code: code.trim()});
      }
      csrf = (await api('/api/session')).csrf_token;
    },
    async enableTOTP() {
      const setup = await api('/api/auth/totp/begin', 'POST', {});
      prompt('Add this otpauth URL to your authenticator; do not share it:', setup.url);
      const code = prompt('Newly generated TOTP code:');
      if (!code) throw new Error('Code not provided.');
      await api('/api/auth/totp/finish', 'POST', {id: setup.id, code: code.trim()});
    },
    async recoveryCodes() {
      const result = await api('/api/auth/recovery-codes', 'POST', {});
      prompt('Store these ten codes in a private vault. Generating new codes invalidates previous codes:', result.codes.join('\n'));
    },
    async makeToken() {
      const result = await api('/api/tokens', 'POST', {name: 'staging', ttl_hours: 1,
        scopes: ['apps:write', 'deploys:write', 'servers:write', 'logs:read', 'settings:write', 'audit:read']});
      N.tokenId = result.id;
      prompt('Copy the token into the hidden terminal prompt. It expires in one hour:', result.token);
      result.token = '';
    },
    async revokeToken() {
      if (!N.tokenId) throw new Error('Check GET /api/tokens and set N.tokenId.');
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
