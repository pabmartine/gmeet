import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

class GMeetManager {
    constructor(extension) {
        this.extension = extension;
        this._bookmarks = [];
        this._indicator = new PanelMenu.Button(0.0, 'Google Meet', false);
        this._separator = null;
        this._horizontalContainer = null;

        const icon = new St.Icon({
            gicon: Gio.icon_new_for_string(
                GLib.build_filenamev([this.extension.path, 'icons', 'gmeet.svg'])
            ),
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);
        Main.panel.addToStatusArea('gmeet', this._indicator);

        // Synchronous menu: _loadBookmarks() is async; without this click can open an empty popup
        // until I/O completes, or never get items if JSON is invalid.
        this._addBookmarksToMenu();

        this._loadBookmarks().catch(err => {
            this._debugLog('Unhandled _loadBookmarks: ' + err.message);
            this._bookmarks = [];
            this._updateMenu();
        });
    }

    /** Guards against malformed JSON; always returns an array */
    _parseBookmarksSafe(text, context) {
        try {
            const raw = typeof text === 'string' ? text.trim() : '';
            const parsed = JSON.parse(raw === '' ? '[]' : raw);
            if (!Array.isArray(parsed))
                throw new Error('not an array');
            return parsed;
        } catch (e) {
            const msg = context ? `${context}: ` : '';
            this._debugLog(`${msg}invalid JSON, using empty list (${e.message})`);
            return [];
        }
    }

    // Load bookmarks from JSON and rebuild menu once via _updateMenu().
    async _loadBookmarks() {
        const bookmarksDir = GLib.build_filenamev([GLib.get_home_dir(), '.gmeet']);
        const bookmarksFilePath = GLib.build_filenamev([bookmarksDir, 'bookmarks.json']);
        const bookmarksFile = Gio.File.new_for_path(bookmarksFilePath);

        const defaultBookmarks = JSON.stringify([{ "name": "test", "url": "https://meet.google.com/aaa-bbbb-ccc" }]);

        try {
            if (!GLib.file_test(bookmarksDir, GLib.FileTest.IS_DIR))
                GLib.mkdir_with_parents(bookmarksDir, 0o755);

            if (!bookmarksFile.query_exists(null)) {
                try {
                    const data = new TextEncoder().encode(defaultBookmarks);
                    await bookmarksFile.replace_contents_bytes_async(
                        new GLib.Bytes(data), null, false, Gio.FileCreateFlags.NONE, null);
                    this._debugLog('Bookmarks file created with default content.');
                } catch (e) {
                    this._debugLog('Failed to create bookmarks file: ' + e.message);
                }
                this._bookmarks = this._parseBookmarksSafe(defaultBookmarks, 'default');
            } else {
                const [success, bin] = await bookmarksFile.load_contents_async(null);
                if (success)
                    this._bookmarks = this._parseBookmarksSafe(new TextDecoder('utf-8').decode(bin), 'bookmarks.json');
                else
                    this._bookmarks = [];
            }
        } catch (e) {
            this._debugLog('Bookmarks load failed: ' + e.message);
            this._bookmarks = [];
        }

        this._updateMenu();
    }

    // Add bookmarks to the extension menu
    _addBookmarksToMenu() {
        this._bookmarks.forEach((bookmark, index) => {
            let menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: true });

            let menuItemLabel = new St.Label({ text: bookmark.name, x_expand: true });
            menuItem.actor.add_child(menuItemLabel);

            let trashIcon = new St.Icon({ icon_name: 'user-trash-symbolic', style_class: 'trash-icon', reactive: true });
            menuItem.actor.add_child(trashIcon);

            this._indicator.menu.addMenuItem(menuItem);

            // Handle bookmark deletion
            trashIcon.connect('button-press-event', () => {
                this._debugLog("delete " + index);
                this._deleteBookmark(index);
                this._indicator.menu.close();
                return Clutter.EVENT_STOP;
            });

            // Handle bookmark selection
            menuItem.connect('activate', () => {
                this._debugLog("web");

                try {
                    let clipboard = St.Clipboard.get_default();
                    clipboard.set_text(St.ClipboardType.CLIPBOARD, bookmark.url);
                } catch (e) {
                    let clipboard = Clutter.Clipboard.get_default();
                    clipboard.set_text(Clutter.ClipboardType.CLIPBOARD, bookmark.url);
                }

                this._openWebPage(bookmark.url);
            });
        });

        this._addAdditionalMenuItems();
    }

    _addAdditionalMenuItems() {
        // Separator/container are disposed by menu.removeAll() before rebuild,
        // with refs cleared in _updateMenu() — avoid double-destroy here.

        if (this._bookmarks.length > 0) {
            this._separator = new PopupMenu.PopupSeparatorMenuItem();
            this._indicator.menu.addMenuItem(this._separator);
        }

        // Create a PopupBaseMenuItem to host the horizontal container
        let containerMenuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false
        });

        // Create the horizontal container for buttons
        this._horizontalContainer = new St.BoxLayout({
            vertical: false,
            style_class: 'horizontal-container',
            x_expand: true
        });

        containerMenuItem.add_child(this._horizontalContainer);

        // Add button
        let addItem = new St.Button({
            label: "Add",
            style_class: 'popup-menu-item',
            x_expand: true
        });
        addItem.connect('clicked', () => {
            this._showAddDialog();
        });
        this._horizontalContainer.add_child(addItem);

        // New button
        let newMeetItem = new St.Button({
            label: "New",
            style_class: 'popup-menu-item',
            x_expand: true
        });
        newMeetItem.connect('clicked', () => {
            this._openWebPage("https://meet.google.com/new");
        });
        this._horizontalContainer.add_child(newMeetItem);

        // Add the container menu item to the menu
        this._indicator.menu.addMenuItem(containerMenuItem);
    }

    // Log messages for debugging
    _debugLog(message) {
        console.debug('[GMeetExtension]: ' + message);
    }

    // Delete a bookmark and update the menu
    _deleteBookmark(index) {
        this._debugLog('_deleteBookmark: ' + index);

        if (index >= 0 && index < this._bookmarks.length) {
            this._bookmarks.splice(index, 1);
            this._updateMenu();
            this._saveBookmarks();
        } else {
            this._debugLog('Índice fuera de rango: ' + index);
        }
    }

    // Update the extension menu after changes
    _updateMenu() {
        this._indicator.menu.removeAll();
        this._separator = null;
        this._horizontalContainer = null;
        this._addBookmarksToMenu();
    }

    // Save bookmarks to the JSON file
    async _saveBookmarks() {
        let jsonString = JSON.stringify(this._bookmarks);
        let data = new GLib.Bytes(new TextEncoder().encode(jsonString));
        const bookmarksDir = GLib.build_filenamev([GLib.get_home_dir(), '.gmeet']);
        const bookmarksFilePath = GLib.build_filenamev([bookmarksDir, 'bookmarks.json']);
        let file = Gio.File.new_for_path(bookmarksFilePath);
        try {
            await file.replace_contents_async(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            this._debugLog('Failed to save bookmarks: ' + e.message);
        }
    }

    // Open a webpage in the default browser
    _openWebPage(url) {
        this._debugLog('_openWebPage: ' + url);
        try {
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            this._debugLog(`Failed to open ${url}: ` + e.message);
        }
    }

    // Show the add bookmark dialog with input validation
    _showAddDialog() {
        this._debugLog('Showing add dialog');

        let modal = new ModalDialog.ModalDialog({});

        let titleLabel = new St.Label({ text: "Add New Google Meet Bookmark", style_class: 'modal-title' });
        modal.contentLayout.add_child(titleLabel);

        let mainContentArea = new St.BoxLayout({ vertical: true });
        modal.contentLayout.add_child(mainContentArea);

        let labelWidth = 100;
        let labelMarginRight = 10;

        let nameContainer = new St.BoxLayout({ vertical: true, style_class: 'input-container' });
        mainContentArea.add_child(nameContainer);

        let nameEntryContainer = new St.BoxLayout({ vertical: false });
        nameContainer.add_child(nameEntryContainer);

        let nameLabel = new St.Label({ text: "Name", style_class: 'name-label', width: labelWidth });
        nameLabel.style = `margin-right: ${labelMarginRight}px;`;
        nameEntryContainer.add_child(nameLabel);

        let nameEntry = new St.Entry({ can_focus: true, style_class: 'name-entry', width: 200 });
        nameEntryContainer.add_child(nameEntry);

        let nameErrorLabel = new St.Label({
            text: "Name is required",
            style_class: 'error-label',
            visible: false,
            style: `color: red; margin-top: 5px; margin-left: ${labelWidth + labelMarginRight}px;`
        });
        nameContainer.add_child(nameErrorLabel);

        let codeContainer = new St.BoxLayout({ vertical: true, style_class: 'input-container' });
        mainContentArea.add_child(codeContainer);

        let codeEntryContainer = new St.BoxLayout({ vertical: false });
        codeContainer.add_child(codeEntryContainer);

        let codeLabel = new St.Label({ text: "Code", style_class: 'code-label', width: labelWidth });
        codeLabel.style = `margin-right: ${labelMarginRight}px;`;
        codeEntryContainer.add_child(codeLabel);

        let codeEntry = new St.Entry({ can_focus: true, style_class: 'code-entry', width: 200 });
        codeEntryContainer.add_child(codeEntry);

        let codeEmptyErrorLabel = new St.Label({
            text: "Code is required",
            style_class: 'error-label',
            visible: false,
            style: `color: red; margin-top: 5px; margin-left: ${labelWidth + labelMarginRight}px;`
        });
        codeContainer.add_child(codeEmptyErrorLabel);

        let codeFormatErrorLabel = new St.Label({
            text: "Required format: xxx-xxxx-xxx",
            style_class: 'error-label',
            visible: false,
            style: `color: red; margin-top: 5px; margin-left: ${labelWidth + labelMarginRight}px;`
        });
        codeContainer.add_child(codeFormatErrorLabel);

        modal.addButton({
            label: "Close",
            action: () => {
                modal.close();
            }
        });

        modal.addButton({
            label: "Save",
            action: () => {
                let name = nameEntry.get_text().trim();
                let code = codeEntry.get_text().trim();
                let isValidName = name !== '';
                let isValidCode = /^.{3}-.{4}-.{3}$/.test(code);
                let isCodeEmpty = code === '';

                nameErrorLabel.visible = !isValidName;
                codeEmptyErrorLabel.visible = isCodeEmpty;
                codeFormatErrorLabel.visible = !isCodeEmpty && !isValidCode;

                if (isValidName && !isCodeEmpty && isValidCode) {
                    this._addNewBookmark(name, code);
                    modal.close();
                }
            }
        });

        modal.open();
    }

    // Add a new bookmark and update the menu
    _addNewBookmark(name, code) {
        this._debugLog('Adding new bookmark: ' + name + ' ' + code);

        this._bookmarks.push({ name: name, url: `https://meet.google.com/${code}` });
        this._updateMenu();
        this._saveBookmarks();
    }
}

class GMeetExtension extends Extension {
    enable() {
        this._manager = new GMeetManager(this);
    }

    disable() {
        if (this._manager && this._manager._indicator) {
            this._manager._indicator.destroy();
            this._manager = null;
        }
    }
}

export default GMeetExtension;
