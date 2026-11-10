// JSON API client. `json` sends a JSON body (POST by default); `form` sends
// multipart FormData. Errors carry the server's `error` message.
export async function api(path, opts = {}) {
  const { json, form, ...rest } = opts;
  const init = { ...rest, headers: { ...(rest.headers || {}) } };
  if (json !== undefined) {
    init.method = init.method || 'POST';
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (form !== undefined) {
    init.method = init.method || 'POST';
    init.body = form;
  }
  const res = await fetch(path, init);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

export const formData = (formEl) => Object.fromEntries(new FormData(formEl));
