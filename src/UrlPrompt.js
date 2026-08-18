// A one-field modal that asks for a url and resolves to what was typed, or to null if
// the student backed out. Built here rather than with window.prompt() for two reasons
// that both matter in this app: prompt() blocks the whole page, which stops the animate
// loop dead mid-frame, and it gives nowhere to put the sentence explaining which kind of
// link actually works -- which is the entire difficulty with framing a video.
//
// It borrows #draw-overlay's box so there is one modal look in the app, not two.
export function askForUrl({
  title = 'Enter a web address',
  hint = '',
  placeholder = 'https://',
  confirmLabel = 'Add',
  value = '',
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'url-overlay';

    const panel = document.createElement('div');
    panel.id = 'url-panel';

    const titleEl = document.createElement('div');
    titleEl.className = 'url-title';
    titleEl.textContent = title;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'url-input';
    input.placeholder = placeholder;
    input.value = value;
    input.spellcheck = false;
    input.autocapitalize = 'off';
    input.autocomplete = 'off';

    const actions = document.createElement('div');
    actions.className = 'url-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'menu-btn';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'menu-btn url-confirm';
    okBtn.textContent = confirmLabel;
    actions.append(cancelBtn, okBtn);

    panel.append(titleEl, input);
    if (hint) {
      const hintEl = document.createElement('div');
      hintEl.className = 'url-hint';
      hintEl.textContent = hint;
      panel.appendChild(hintEl);
    }
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(result);
    };

    // Capture phase: PlayerController and VRView both listen on window for keys, and Esc
    // here means "close this box", not "leave VR".
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter' && document.activeElement === input) {
        e.stopPropagation();
        close(input.value);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => close(input.value));
    // Clicking the dark surround is the other way everyone tries to dismiss a box.
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close(null);
    });

    // Deferred: the element has to be in the document and laid out before focus takes,
    // and on a tablet this is also what raises the keyboard.
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}
