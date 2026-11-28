// Small pop-ups: a toast, a question with buttons, a box to type a name into, and a modal frame.
// None of them uses window.alert/confirm/prompt, which freeze the page and the stage with it.

let host = null;
function toastHost() {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, { kind = 'info', ms = 3200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  toastHost().appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// A modal. `build(body, close)` fills it; resolves with whatever close() is given.
export function modal(title, build, { wide = false, className = '' } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = `modal${wide ? ' modal-wide' : ''} ${className}`;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.innerHTML = `<div class="modal-head"><h2>${escapeHtml(title)}</h2><button type="button" class="modal-x" aria-label="Close">×</button></div><div class="modal-body"></div>`;
    back.appendChild(box);
    document.body.appendChild(back);
    const prevFocus = document.activeElement;
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      back.remove();
      window.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
    };
    window.addEventListener('keydown', onKey, true);
    box.querySelector('.modal-x').addEventListener('click', () => close(null));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    build(box.querySelector('.modal-body'), close, box);
    (box.querySelector('[autofocus]') || box.querySelector('.modal-body button, .modal-body input'))?.focus();
  });
}

// A question with buttons; resolves with the chosen button's value (null if closed).
export function ask(title, text, buttons) {
  return modal(title, (body, close) => {
    body.innerHTML = `<p class="modal-text">${escapeHtml(text)}</p><div class="modal-buttons"></div>`;
    const row = body.querySelector('.modal-buttons');
    buttons.forEach(([value, label, primary], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn btn-primary' : 'btn';
      b.textContent = label;
      if (i === 0) b.autofocus = true;
      b.addEventListener('click', () => close(value));
      row.appendChild(b);
    });
  });
}

// A box to type into. `check(value)` returns an error message, or nothing if the value is fine.
export function promptText(title, { label = '', value = '', ok = 'OK', check = null, extra = null } = {}) {
  return modal(title, (body, close) => {
    body.innerHTML = `<label class="field"><span>${escapeHtml(label)}</span><input type="text" autofocus maxlength="60"></label><div class="field-extra"></div><p class="field-error" role="alert"></p><div class="modal-buttons"><button type="button" class="btn">Cancel</button><button type="button" class="btn btn-primary"></button></div>`;
    const input = body.querySelector('input');
    input.value = value;
    const err = body.querySelector('.field-error');
    const extraBox = body.querySelector('.field-extra');
    const extraState = extra ? extra(extraBox) : null;
    const [cancel, okBtn] = body.querySelectorAll('.modal-buttons button');
    okBtn.textContent = ok;
    const submit = () => {
      const v = input.value.trim();
      const problem = check?.(v, extraState);
      if (problem) { err.textContent = problem; input.focus(); return; }
      close(extra ? { value: v, extra: extraState?.() } : v);
    };
    cancel.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); e.stopPropagation(); });
    setTimeout(() => input.select(), 0);
  });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}
