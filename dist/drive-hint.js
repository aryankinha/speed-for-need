// On-screen keyboard prompt shown for the first seconds of driving, so web players see the controls
// without opening the pause menu (CrazyGames onboarding requirement).
export const DRIVE_HINT_MS = 8000;

export class DriveHint {
  constructor(element, { duration = DRIVE_HINT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.element = element;
    this.duration = duration;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.shown = false;
  }
  /** Show once per session; later drives stay clean. */
  show() {
    if (this.shown || !this.element) return false;
    this.shown = true;
    this.shownAt = Date.now();
    this.element.hidden = false;
    this.timer = this.setTimer(() => this.hide(), this.duration);
    return true;
  }
  /** Player has clearly got the controls: drop the prompt after it has been readable for a moment. */
  dismiss(minMs = 1500) {
    if (this.timer !== null && Date.now() - this.shownAt >= minMs) this.hide();
  }
  hide() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    if (this.element) this.element.hidden = true;
  }
}

export const DRIVE_HINT_HTML = [
  '<div class="dh-group"><span class="dh-keys wasd"><i></i><kbd>W</kbd><i></i><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span class="dh-label">DRIVE <small>or arrow keys</small></span></div>',
  '<div class="dh-group"><span class="dh-keys"><kbd class="wide">SHIFT</kbd></span><span class="dh-label">NITRO</span></div>',
  '<div class="dh-group"><span class="dh-keys"><kbd class="wide">SPACE</kbd></span><span class="dh-label">DRIFT</span></div>',
  '<div class="dh-group"><span class="dh-keys"><kbd>P</kbd></span><span class="dh-label">PAUSE</span></div>',
].join('');
