import Dropdown from '../design-system/components/dropdown/dropdown.js';

const MENU_GAP = 4;

let menuIdCounter = 0;

/**
 * Dropdown that renders its open menu in <body> instead of inside its own
 * container.
 *
 * The design-system Dropdown draws the menu as a child of the container, so any
 * ancestor that clips overflow cuts the menu off — the settings modal body
 * scrolls, so it does exactly that. Unclipping those ancestors is not a usable
 * workaround: it also frees tall fields lower in the form to paint over the
 * modal footer. Moving just the menu out sidesteps both.
 *
 * Extra options on top of the base component:
 *   matchToggleWidth — size the menu to its toggle rather than the stylesheet's
 *                      fixed width.
 *   menuClassName    — class(es) for the panel. Once it leaves the container,
 *                      selectors that reach it through the container no longer
 *                      match, so styling needs a hook of its own.
 */
export default class PortalDropdown extends Dropdown {
  // Note: the base constructor calls init(), so this runs before any subclass
  // constructor body would. Everything here must stand on its own.
  init() {
    super.init();

    if (this.config.menuClassName) {
      this.menu.classList.add(...this.config.menuClassName.split(' ').filter(Boolean));
    }

    menuIdCounter += 1;
    this.menu.id = this.menu.id || `portal-dropdown-menu-${menuIdCounter}`;
    this.toggle.setAttribute('aria-controls', this.menu.id);

    // The base component closes on a bubble-phase document click, which never
    // arrives when an ancestor stops propagation — Modal does, on dialog
    // clicks, so a dropdown inside one would stay open. Capture phase sees the
    // click regardless, and the portaled menu needs testing separately because
    // it is no longer inside the container.
    this._onCaptureClick = (event) => {
      if (!this.isOpen) return;
      if (this.container.contains(event.target)) return;
      if (this.menu.contains(event.target)) return;
      this.close();
    };
    document.addEventListener('click', this._onCaptureClick, true);
  }

  updateToggleState() {
    super.updateToggleState();
    if (this.isOpen) {
      this.mountMenu();
    } else {
      this.unmountMenu();
    }
  }

  mountMenu() {
    if (!this._placeholder) {
      this._placeholder = document.createElement('span');
      this._placeholder.hidden = true;
    }

    if (this.menu.parentElement !== document.body) {
      const width = this.measureMenuWidth();
      this.container.insertBefore(this._placeholder, this.menu);
      document.body.appendChild(this.menu);
      if (width) this.menu.style.width = `${width}px`;
    }

    this.menu.classList.add('dropdown-menu--portaled');
    this.positionMenu();

    if (!this._onScroll) {
      this._onScroll = () => { if (this.isOpen) this.positionMenu(); };
      this._onResize = () => {
        if (!this.isOpen) return;
        // A breakpoint may have changed the width the menu would have had.
        this.remeasureMenuWidth();
        this.positionMenu();
      };
      window.addEventListener('resize', this._onResize);
      // Capture phase also catches nested scroll containers, e.g. the modal body.
      window.addEventListener('scroll', this._onScroll, true);
    }
  }

  unmountMenu() {
    if (this._onScroll) {
      window.removeEventListener('scroll', this._onScroll, true);
      this._onScroll = null;
    }
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }

    this.menu?.classList.remove('dropdown-menu--portaled');
    if (this.menu) {
      this.menu.style.top = '';
      this.menu.style.left = '';
      // growToFit owns the inline width in that mode; otherwise it was ours.
      if (!this.config.growToFit) this.menu.style.width = '';
    }

    if (this._placeholder?.parentElement && this.menu?.parentElement === document.body) {
      this._placeholder.parentElement.insertBefore(this.menu, this._placeholder);
      this._placeholder.remove();
    }
  }

  /**
   * Width has to be read while the menu is still in the container: the
   * stylesheet sizes it with `width: 100%` on narrow viewports, which would
   * resolve against <body> once moved.
   */
  measureMenuWidth() {
    return this.config.matchToggleWidth ? this.toggle.offsetWidth : this.menu.offsetWidth;
  }

  remeasureMenuWidth() {
    if (!this._placeholder?.parentElement) return;
    if (this.menu.parentElement !== document.body) return;

    const parent = this._placeholder.parentElement;
    parent.insertBefore(this.menu, this._placeholder);
    this.menu.classList.remove('dropdown-menu--portaled');
    this.menu.style.width = '';
    const width = this.measureMenuWidth();

    document.body.appendChild(this.menu);
    this.menu.classList.add('dropdown-menu--portaled');
    if (width) this.menu.style.width = `${width}px`;
  }

  /** Pin the menu under its toggle, flipping or clamping to stay on screen. */
  positionMenu() {
    if (!this.menu || !this.toggle) return;

    const toggleRect = this.toggle.getBoundingClientRect();
    const menuHeight = this.menu.offsetHeight;
    const menuWidth = this.menu.offsetWidth;
    const spaceBelow = window.innerHeight - toggleRect.bottom - MENU_GAP;

    const flipUp = spaceBelow < menuHeight && toggleRect.top - MENU_GAP > spaceBelow;
    const top = flipUp
      ? Math.max(MENU_GAP, toggleRect.top - MENU_GAP - menuHeight)
      : Math.min(
        toggleRect.bottom + MENU_GAP,
        Math.max(MENU_GAP, window.innerHeight - MENU_GAP - menuHeight),
      );
    const left = Math.min(
      Math.max(MENU_GAP, toggleRect.left),
      Math.max(MENU_GAP, window.innerWidth - MENU_GAP - menuWidth),
    );

    this.menu.style.top = `${Math.round(top)}px`;
    this.menu.style.left = `${Math.round(left)}px`;
  }

  destroy() {
    this.unmountMenu();
    // The menu is still in <body> if it was never returned to the container.
    if (this.menu?.parentElement === document.body) this.menu.remove();

    if (this._onCaptureClick) {
      document.removeEventListener('click', this._onCaptureClick, true);
      this._onCaptureClick = null;
    }
    this._placeholder?.remove();
    this._placeholder = null;

    super.destroy();
  }
}
