/**
 * The in-game settings/help overlay, toggled with the "m" key.
 *
 * This is a p5 DOM element (a div layered on top of the canvas), not something
 * drawn into the canvas, so everything below is styled with CSS.
 */

/** Every control the player needs, as [key, what it does]. */
const CONTROLS: string[][] = [
    ["Left Arrow", "Move left"],
    ["Right Arrow", "Move right"],
    ["Spacebar", "Jump"],
    ["M", "Open / close this menu"],
    ["Esc", "Toggle full screen"],
];

const TEXT_COLOR = "#ffffff";

export class Settings {
    public playMusic: boolean;
    public playEvents: boolean;

    music: p5.SoundFile;

    menu: p5.Element;
    full: p5.Element;

    constructor() {
        this.playMusic = false;
        this.playEvents = true;
        this.menu = createDiv();
        this.menu.style("background-color", "rgba(0,0,0,0.75)");
        this.menu.style("box-sizing", "border-box");
        this.menu.style("padding", "24px");
        this.menu.style("color", TEXT_COLOR);
        this.menu.style("font-family", "Helvetica, Arial, sans-serif");
        this.menu.style("font-size", "18px");
        this.menu.style("overflow", "auto");
        this.menu.position(30, 30);
        this.addControls();
        this.addHeading("Settings");
        const music = createCheckbox("Play Music", this.playMusic);
        music.changed(this.togglePlayMusic.bind(this));
        this.styleOption(music);
        this.menu.child(music);
        const events = createCheckbox("Play Event Sounds", true);
        events.changed(this.toogleEventSounds.bind(this));
        this.styleOption(events);
        this.menu.child(events);
        this.full = createCheckbox("Full Screen", false);
        this.full.changed(this.toggleFullScreen.bind(this));
        this.styleOption(this.full);
        this.menu.child(this.full);
        this.menu.hide();
    }

    /** Lists the key bindings so a new player knows how to play. */
    addControls() {
        this.addHeading("Controls");
        for (const [keyName, description] of CONTROLS) {
            const row = createDiv(
                `<span style="display:inline-block;min-width:140px;font-weight:bold">` +
                    `${keyName}</span>${description}`
            );
            row.style("color", TEXT_COLOR);
            row.style("line-height", "1.6");
            this.menu.child(row);
        }
    }

    addHeading(label: string) {
        const heading = createDiv(label);
        heading.style("color", TEXT_COLOR);
        heading.style("font-size", "24px");
        heading.style("font-weight", "bold");
        heading.style("margin", "16px 0 8px 0");
        this.menu.child(heading);
    }

    styleOption(option: p5.Element) {
        option.style("color", TEXT_COLOR);
        option.style("line-height", "1.6");
    }

    showMenu() {
        const scaleFactor = min(width / 800, height / 600);
        this.menu.size(800 * scaleFactor - 60, 600 * scaleFactor - 60);
        this.menu.show();
    }

    hideMenu() {
        this.menu.hide();
    }

    toggleFullScreen() {
        fullscreen(!fullscreen());
    }

    togglePlayMusic() {
        this.playMusic = !this.playMusic;
        if (this.playMusic) {
            this.music.setLoop(true);
            this.music.playMode("restart");
            this.music.play();
        } else {
            this.music.stop();
        }
    }

    setMusic(m: p5.SoundFile) {
        this.music = m;
    }

    toogleEventSounds() {
        this.playEvents = !this.playEvents;
    }
}
