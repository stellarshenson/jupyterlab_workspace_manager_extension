import { Dialog, showDialog } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';

import {
  cleanPurpose,
  NAME_RULE,
  nameProblem,
  purposeCounter
} from '../model/new';

/**
 * The footer of a dialog (DQ-14): one filled primary action, a surface Cancel and,
 * for a destructive action, an unfilled error-coloured button at the far left.
 */
const BUTTON = 'jp-WorkspaceManager-dialogButton';
const PRIMARY = 'jp-WorkspaceManager-primary';
const SECONDARY = 'jp-WorkspaceManager-secondary';
const DANGER = 'jp-WorkspaceManager-danger';

/**
 * A dialog whose accept button follows the form: Enter, in the name field or
 * in the description box, accepts only a valid form, and the description box
 * takes no line break, so Enter there accepts too.
 */
class FormDialog<T> extends Dialog<T> {
  constructor(
    options: Partial<Dialog.IOptions<T>>,
    private _valid: () => boolean
  ) {
    super(options);
  }

  resolve(index?: number): void {
    // the buttons are Cancel, then the accept button, which is the default
    if (index !== 0 && !this._valid()) {
      return;
    }
    super.resolve(index);
  }

  handleEvent(event: Event): void {
    const key = event as KeyboardEvent;
    if (
      event.type === 'keydown' &&
      key.key === 'Enter' &&
      !key.isComposing &&
      event.target instanceof HTMLTextAreaElement
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.resolve();
      return;
    }
    super.handleEvent(event);
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** The three-line Short description box with its `<n>/100` counter. */
function descriptionField(parent: HTMLElement, value: string) {
  const label = element(
    'label',
    'jp-WorkspaceManager-fieldLabel',
    'Short description (optional)'
  );
  const area = element('textarea', 'jp-mod-styled jp-WorkspaceManager-area');
  area.rows = 3;
  area.value = value;
  label.appendChild(area);
  const counter = element(
    'div',
    'jp-WorkspaceManager-counter',
    purposeCounter(value)
  );
  area.addEventListener('input', () => {
    const clean = cleanPurpose(area.value);
    if (clean !== area.value) {
      const at = Math.min(area.selectionStart, clean.length);
      area.value = clean;
      area.setSelectionRange(at, at);
    }
    counter.textContent = purposeCounter(area.value);
  });
  parent.append(label, counter);
  return area;
}

class NewWorkspaceBody extends Widget {
  constructor(private _existing: string[]) {
    super();
    this.addClass('jp-WorkspaceManager-form');
    const label = element('label', 'jp-WorkspaceManager-fieldLabel', 'Name');
    this.name = element('input', 'jp-mod-styled jp-WorkspaceManager-name');
    this.name.spellcheck = false;
    label.appendChild(this.name);
    this._rule = element('div', 'jp-WorkspaceManager-rule');
    this.node.append(label, this._rule);
    this.area = descriptionField(this.node, '');
    this.name.addEventListener('input', () => this._check());
  }

  readonly name: HTMLInputElement;
  readonly area: HTMLTextAreaElement;

  get valid(): boolean {
    return nameProblem(this.name.value, this._existing) === null;
  }

  getValue(): { name: string; purpose: string } {
    return { name: this.name.value, purpose: this.area.value };
  }

  protected onAfterAttach(): void {
    this._check();
  }

  /** The rule stands under the field; a typed problem replaces it with the reason as a state line. */
  private _check(): void {
    const problem = nameProblem(this.name.value, this._existing);
    const taken = problem !== null && problem !== NAME_RULE;
    this._rule.textContent = problem ?? NAME_RULE;
    // an empty field still shows the rule as the hint
    this._rule.classList.toggle(
      'jp-mod-error',
      problem !== null && this.name.value !== ''
    );
    this.name.classList.toggle('jp-mod-invalid', taken);
    // set after the dialog's own input check, which looks for .jp-mod-error only
    const accept = this.node
      .closest('.jp-Dialog-content')
      ?.querySelector<HTMLButtonElement>('.jp-mod-accept');
    if (accept) {
      accept.disabled = problem !== null;
    }
  }

  private _rule: HTMLDivElement;
}

/** The New workspace dialog; `existing` is a fresh list of workspace ids. */
export async function newWorkspaceDialog(
  existing: string[]
): Promise<{ name: string; purpose: string } | null> {
  const body = new NewWorkspaceBody(existing);
  const dialog = new FormDialog(
    {
      title: 'New workspace',
      body,
      buttons: [
        Dialog.cancelButton({ className: `${BUTTON} ${SECONDARY}` }),
        Dialog.okButton({
          label: 'Create',
          className: `${BUTTON} ${PRIMARY}`
        })
      ],
      focusNodeSelector: 'input'
    },
    () => body.valid
  );
  dialog.addClass('jp-WorkspaceManager-dialog');
  const result = await dialog.launch();
  return result.button.accept ? result.value : null;
}

class DescriptionBody extends Widget {
  constructor(value: string) {
    super();
    this.addClass('jp-WorkspaceManager-form');
    this._area = descriptionField(this.node, value);
  }

  getValue(): string {
    return this._area.value;
  }

  private _area: HTMLTextAreaElement;
}

/** Set description: the field holds the current purpose; null on Cancel. */
export async function descriptionDialog(
  name: string,
  purpose: string
): Promise<string | null> {
  const dialog = new FormDialog(
    {
      title: `Set description of ${name}`,
      body: new DescriptionBody(purpose),
      buttons: [
        Dialog.cancelButton({ className: `${BUTTON} ${SECONDARY}` }),
        Dialog.okButton({ label: 'Save', className: `${BUTTON} ${PRIMARY}` })
      ],
      focusNodeSelector: 'textarea'
    },
    () => true
  );
  dialog.addClass('jp-WorkspaceManager-dialog');
  const result = await dialog.launch();
  return result.button.accept ? result.value : null;
}

/**
 * Ask once before an action; true when the user confirms it. A destructive action
 * stands unfilled in the error colour at the far left; Cancel keeps the right (DQ-14).
 */
export async function confirm(
  title: string,
  body: string,
  label: string,
  danger = true
): Promise<boolean> {
  const cancel = Dialog.cancelButton({ className: `${BUTTON} ${SECONDARY}` });
  const result = await showDialog({
    title,
    body,
    buttons: danger
      ? [Dialog.warnButton({ label, className: `${BUTTON} ${DANGER}` }), cancel]
      : [cancel, Dialog.okButton({ label, className: `${BUTTON} ${PRIMARY}` })]
  });
  return result.button.accept;
}
