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
    constructor(metadata) {
        this.metadata = metadata;
        this._bookmarks = [];
        this._indicator = new PanelMenu.Button(0.0, 'Google Meet', false);
        this._horizontalContainer = null;  // Inicializar el contenedor aquí

        const icon = new St.Icon({
            gicon: Gio.icon_new_for_string(
                GLib.build_filenamev([this.metadata.path, 'icons', 'gmeet.svg'])
            ),
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);
        Main.panel.addToStatusArea('gmeet', this._indicator);

        this._loadBookmarks();
    }

    // Load bookmarks from a JSON file
    _loadBookmarks() {
        const bookmarksDir = GLib.build_filenamev([GLib.get_home_dir(), '.gmeet']);
        const bookmarksFilePath = GLib.build_filenamev([bookmarksDir, 'bookmarks.json']);
        const bookmarksFile = Gio.File.new_for_path(bookmarksFilePath);

        // Ensure the directory exists
        if (!GLib.file_test(bookmarksDir, GLib.FileTest.IS_DIR)) {
            GLib.mkdir_with_parents(bookmarksDir, 0o755);
        }

        // Default content for the bookmarks file
        const defaultBookmarks = JSON.stringify([{ "name": "test", "url": "https://meet.google.com/aaa-bbbb-ccc" }]);

        if (!bookmarksFile.query_exists(null)) {
            // If the file does not exist, create it with the default content
            let data = new TextEncoder().encode(defaultBookmarks); // Encode to Uint8Array
            bookmarksFile.replace_contents_bytes_async(new GLib.Bytes(data), null, false, Gio.FileCreateFlags.NONE, null, (file, result) => {
                try {
                    file.replace_contents_finish(result);
                    this._debugLog('Bookmarks file created with default content.');
                    this._bookmarks = JSON.parse(defaultBookmarks);
                    this._addBookmarksToMenu();
                } catch (e) {
                    this._debugLog('Failed to create bookmarks file: ' + e.message);
                }
            });
        } else {
            bookmarksFile.load_contents_async(null, (file, result) => {
                try {
                    const [success, data] = file.load_contents_finish(result);
                    if (success) {
                        this._bookmarks = JSON.parse(new TextDecoder("utf-8").decode(data));
                        this._addBookmarksToMenu();
                    }
                } catch (e) {
                    this._debugLog('Failed to load bookmarks: ' + e.message);
                }
            });
        }
    }

    // Add bookmarks to the extension menu
    _addBookmarksToMenu() {
        this._bookmarks.forEach((bookmark, index) => {
            let menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: true });

            let menuItemLabel = new St.Label({ text: bookmark.name, x_expand: true });
            menuItem.actor.add_child(menuItemLabel);

            let trashIcon = new St.Icon({ icon_name: 'user-trash-symbolic', style_class: 'trash-icon' });
            menuItem.actor.add_child(trashIcon);

            this._indicator.menu.addMenuItem(menuItem);

            // Handle bookmark selection and deletion
            menuItem.connect('activate', () => {
                let [pointerX, pointerY] = global.get_pointer();
                let [iconX, iconY] = trashIcon.get_transformed_position();
                let iconWidth = trashIcon.get_width();
                let iconHeight = trashIcon.get_height();

                this._debugLog(pointerX >= iconX);
                this._debugLog(index);

                if (pointerX >= iconX) {
                    this._debugLog("delete " + index);
                    this._deleteBookmark(index);
                } else {
                    this._debugLog("web");

                    let clipboard = St.Clipboard.get_default();
                    clipboard.set_text(St.ClipboardType.CLIPBOARD, bookmark.url);

                    this._openWebPage(bookmark.url);
                }
            });
        });

        this._addAdditionalMenuItems();
    }

    _addAdditionalMenuItems() {
        log("Adding extra menu items");

        // Remove existing separator and button container
        if (this._separator) {
            this._separator.destroy();
            this._separator = null;
        }

        if (this._horizontalContainer) {
            this._horizontalContainer.destroy();
            this._horizontalContainer = null;
        }

        // Create horizontal separator
        // Only add the separator if there are bookmarks
        if (this._bookmarks.length > 0) {
            // Create the horizontal separator
            this._separator = new PopupMenu.PopupSeparatorMenuItem();
            if (this._separator) {
                log("Separator created successfully.");
                this._indicator.menu.addMenuItem(this._separator);
            } else {
                log("Error: couldn't create the separator.");
            }
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
        if (typeof global.log === 'function') {
            global.log('[GMeetExtension]: ' + message);
        } else {
            console.log('[GMeetExtension]: ' + message);
        }
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
        this._addBookmarksToMenu();
    }

    // Save bookmarks to the JSON file
    _saveBookmarks() {
        let jsonString = JSON.stringify(this._bookmarks);
        let data = new GLib.Bytes(jsonString);
        const bookmarksDir = GLib.build_filenamev([GLib.get_home_dir(), '.gmeet']);
        const bookmarksFilePath = GLib.build_filenamev([bookmarksDir, 'bookmarks.json']);
        let file = Gio.File.new_for_path(bookmarksFilePath);
        file.replace_contents_async(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (file, result) => {
            try {
                file.replace_contents_finish(result);
            } catch (e) {
                this._debugLog('Failed to save bookmarks: ' + e.message);
            }
        });
    }

    // Open a webpage in the default browser
    _openWebPage(url) {
        this._debugLog('_openWebPage: ' + url);
        let command = `xdg-open '${url}'`;
        try {
            GLib.spawn_command_line_async(command);
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
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this._manager = new GMeetManager(this.metadata);
    }

    disable() {
        this._manager._indicator.destroy();
        this._manager = null;
    }
}

export default GMeetExtension;
