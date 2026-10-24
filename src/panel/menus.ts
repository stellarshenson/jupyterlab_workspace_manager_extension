import {
  deleteIcon,
  editIcon,
  launchIcon,
  type LabIcon,
  MenuSvg
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import type { Message } from '@lumino/messaging';
import type { Menu } from '@lumino/widgets';

import { closeTabsIcon, eyeOffIcon, openIcon, swatchIcons } from '../icons';
import { DeleteArm } from '../model/menu';
import { COLOURS, type Colour } from '../model/palette';

/** The menu labels of the palette colours. */
export const COLOUR_LABELS: Record<Colour, string> = {
  rose: 'Red',
  peach: 'Orange',
  lemon: 'Yellow',
  mint: 'Green',
  sky: 'Blue',
  lavender: 'Purple'
};

const DELETE = 'delete';

/**
 * JupyterLab's menu renderer draws a check in place of the icon of a toggled
 * item; the Colour submenu keeps every swatch, and the CSS adds the check.
 */
class SwatchRenderer extends MenuSvg.Renderer {
  renderIcon(data: Menu.IRenderData) {
    const item = Object.create(data.item, { isToggled: { value: false } });
    return super.renderIcon({ ...data, item });
  }
}
const swatchRenderer = new SwatchRenderer();

/**
 * A Lumino menu that keeps itself open on the click that arms Delete
 * workspace. Lumino triggers an item on the pointer release and closes the
 * menu first; the delete item instead waits for the click event, whose
 * `detail` counts the clicks, so the second click of a double-click is known.
 * The menu listens for clicks itself: the Lumino the lab ships may not.
 */
class ArmedMenu extends MenuSvg {
  constructor(
    commands: CommandRegistry,
    private _arm: DeleteArm,
    private _delete: () => void
  ) {
    super({ commands });
    this.aboutToClose.connect(() => this._arm.disarm());
  }

  protected onBeforeAttach(msg: Message): void {
    super.onBeforeAttach(msg);
    this.node.addEventListener('click', this);
  }

  protected onAfterDetach(msg: Message): void {
    this.node.removeEventListener('click', this);
    super.onAfterDetach(msg);
  }

  handleEvent(event: Event): void {
    this._event = event;
    if (event.type === 'click' && this._onDeleteItem(event)) {
      this._press(event as MouseEvent);
    }
    super.handleEvent(event);
  }

  triggerActiveItem(): void {
    if (this.activeItem?.command !== DELETE) {
      super.triggerActiveItem();
    } else if (this._event?.type === 'keydown') {
      this._press({ detail: 0, timeStamp: this._event.timeStamp });
    }
    // a pointer release waits for its click event
  }

  private _onDeleteItem(event: Event): boolean {
    const node = this.contentNode.children[this.activeIndex];
    return (
      this.activeItem?.command === DELETE &&
      !!node?.contains(event.target as Node)
    );
  }

  private _press(event: { detail: number; timeStamp: number }): void {
    if (!this.commands.isEnabled(DELETE)) {
      return;
    }
    if (this._arm.click(event)) {
      this.close();
      this._delete();
    } else {
      this.update();
    }
  }

  private _event: Event | null = null;
}

export interface IWorkspaceActions {
  open(): void;
  openInNewTab(): void;
  closeAll(): void;
  describe(): void;
  colour(colour: Colour): void;
  hide(): void;
  delete(): void;
}

/** The ... menu of a workspace card, in the order of the design. */
export function workspaceMenu(
  colour: Colour | null,
  current: boolean,
  actions: IWorkspaceActions
): Menu {
  const commands = new CommandRegistry();
  const arm = new DeleteArm(() => menu.update());
  const menu = new ArmedMenu(commands, arm, actions.delete);
  menu.addClass('jp-WorkspaceManager-menu');
  const add = (
    id: string,
    label: string,
    icon: LabIcon,
    execute: () => void,
    isEnabled = () => true
  ) => {
    commands.addCommand(id, { label, icon, execute, isEnabled });
    menu.addItem({ command: id });
  };
  add('open', 'Open workspace', openIcon, actions.open, () => !current);
  add(
    'open-tab',
    'Open in new browser tab',
    launchIcon,
    actions.openInNewTab,
    () => !current
  );
  add('close-all', 'Close all tabs', closeTabsIcon, actions.closeAll);
  menu.addItem({ type: 'separator' });
  add('describe', 'Set description...', editIcon, actions.describe);

  const colours = new MenuSvg({ commands, renderer: swatchRenderer });
  colours.addClass('jp-WorkspaceManager-menu');
  colours.addClass('jp-WorkspaceManager-colourMenu');
  colours.title.label = 'Colour';
  if (colour) {
    colours.title.icon = swatchIcons[colour];
  }
  for (const c of COLOURS) {
    commands.addCommand(`colour-${c}`, {
      label: COLOUR_LABELS[c],
      icon: swatchIcons[c],
      isToggled: () => c === colour,
      execute: () => actions.colour(c)
    });
    colours.addItem({ command: `colour-${c}` });
  }
  menu.addItem({ type: 'submenu', submenu: colours });
  add('hide', 'Hide workspace', eyeOffIcon, actions.hide, () => !current);
  menu.addItem({ type: 'separator' });
  commands.addCommand(DELETE, {
    label: () => (arm.armed ? 'Confirm delete' : 'Delete workspace'),
    className: () => (arm.armed ? 'jp-mod-confirm' : ''),
    icon: deleteIcon,
    isEnabled: () => !current,
    execute: () => undefined
  });
  menu.addItem({ command: DELETE });
  menu.aboutToClose.connect(() =>
    setTimeout(() => {
      menu.dispose();
      colours.dispose();
    })
  );
  return menu;
}

/** A menu of plain actions: a row's context menu, or the ... of In no workspace. */
export function actionMenu(
  items: { label: string; icon: LabIcon; execute: () => void }[]
): Menu {
  const commands = new CommandRegistry();
  const menu = new MenuSvg({ commands });
  menu.addClass('jp-WorkspaceManager-menu');
  items.forEach(({ label, icon, execute }, i) => {
    commands.addCommand(`item-${i}`, { label, icon, execute });
    menu.addItem({ command: `item-${i}` });
  });
  menu.aboutToClose.connect(() => setTimeout(() => menu.dispose()));
  return menu;
}
