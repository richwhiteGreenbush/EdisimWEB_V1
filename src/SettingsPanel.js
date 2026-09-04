import { SETTING_ROWS, getSetting, setSetting } from './Settings.js';

// The settings screen. Built from SETTING_ROWS rather than hand-written here, so the
// switches and the thing that reads them cannot drift apart -- the same argument main.js's
// `menuActions` makes about the two menus.
//
// Everything is a BUTTON, never a checkbox. A checkbox says "on/off" and gives no room to
// say what off means; three labelled buttons say "Follow my device / On / Off" and a
// nine-year-old can read the state without knowing the convention. It also keeps every
// control the same size, which matters on a touchscreen.
export class SettingsPanel {
  constructor({ onChange } = {}) {
    this.onChange = onChange;

    this.root = document.createElement('div');
    this.root.id = 'settings-panel';
    this.root.hidden = true;

    this.box = document.createElement('div');
    this.box.className = 'set-box';
    this.root.appendChild(this.box);

    // Click the backdrop to dismiss, but not a click that started inside the box -- a
    // student dragging the speed slider past the edge should not have the panel close
    // under their finger.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });

    document.body.appendChild(this.root);
  }

  open() {
    this.render();
    this.root.hidden = false;
  }

  close() {
    this.root.hidden = true;
  }

  render() {
    this.box.innerHTML = '';

    const h = document.createElement('h2');
    h.textContent = 'Settings';
    this.box.appendChild(h);

    const lede = document.createElement('p');
    lede.className = 'set-lede';
    lede.textContent =
      'These stay on this computer, and they are not part of your world — saving or sharing a world does not carry them.';
    this.box.appendChild(lede);

    for (const row of SETTING_ROWS) {
      const wrap = document.createElement('div');
      wrap.className = 'set-row';

      const label = document.createElement('label');
      label.textContent = row.label;
      wrap.appendChild(label);

      const help = document.createElement('p');
      help.className = 'set-help';
      help.textContent = row.help;
      wrap.appendChild(help);

      const choices = document.createElement('div');
      choices.className = 'set-choices';

      // A toggle is just a two-option choice. Expressed that way so both kinds of row
      // render through one path and look identical.
      const options = row.toggle
        ? [{ value: true, label: 'On' }, { value: false, label: 'Off' }]
        : row.options;

      for (const option of options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'set-choice';
        btn.textContent = option.label;
        if (getSetting(row.name) === option.value) btn.classList.add('is-on');
        btn.addEventListener('click', () => {
          setSetting(row.name, option.value);
          // Re-render rather than toggling a class: a change to `motion` can change what
          // the other rows effectively mean, and redrawing is cheaper than tracking that.
          this.render();
          this.onChange?.(row.name, option.value);
        });
        choices.appendChild(btn);
      }

      wrap.appendChild(choices);
      this.box.appendChild(wrap);
    }

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'set-done';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.close());
    this.box.appendChild(done);
  }
}
