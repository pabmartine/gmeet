import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';


export default class GMeetExtension extends Extension {

    // Initialize the extension
    enable() {
        this._bookmarks = [];
        this._indicator = new PanelMenu.Button(0.0, 'Google Meet', false);
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

    // Clean up on extension disable
    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }

    // Load bookmarks from a JSON file
    _loadBookmarks() {
        const metadataFile = Gio.File.new_for_path(
            GLib.build_filenamev([this.metadata.path, 'metadata.json'])
        );
    
        if (metadataFile.query_exists(null)) {
            let [success, contents] = metadataFile.load_contents(null);
            this._hasMetadata = success && contents.length > 0;
        } else {
            this._hasMetadata = false;
        }
    
        const bookmarksFile = Gio.File.new_for_path(
            GLib.build_filenamev([this.metadata.path, 'bookmarks.json'])
        );
    
        if (!bookmarksFile.query_exists(null)) {
            // Si el archivo no existe, crea uno vacío
            let initialContent = JSON.stringify([]);
            let data = new TextEncoder().encode(initialContent); // Codificar a Uint8Array
            bookmarksFile.replace_contents_bytes_async(new GLib.Bytes(data), null, false, Gio.FileCreateFlags.NONE, null, (file, result) => {
                try {
                    file.replace_contents_finish(result);
                    this._debugLog('Bookmarks file created.');
                } catch (e) {
                    this._debugLog('Failed to create bookmarks file: ' + e.message);
                }
            });
            this._bookmarks = [];
            return;
        }
    
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
                    this._openWebPage(bookmark.url);
                }
            });
        });

        this._addAdditionalMenuItems();
    }

    // Add additional menu items like 'New Meet', 'Add', and 'Help'
    _addAdditionalMenuItems() {

        if (this._hasMetadata) {
            let separator = new PopupMenu.PopupSeparatorMenuItem();
            this._indicator.menu.addMenuItem(separator);
        }

        let newMeetItem = new PopupMenu.PopupMenuItem('New Meet');
        newMeetItem.connect('activate', () => {
            this._openWebPage("https://meet.google.com/new");
        });
        this._indicator.menu.addMenuItem(newMeetItem);

        let secondSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._indicator.menu.addMenuItem(secondSeparator);

        let addItem = new PopupMenu.PopupMenuItem('Add');
        addItem.connect('activate', () => {
            this._showAddDialog();
        });
        this._indicator.menu.addMenuItem(addItem);

        let helpItem = new PopupMenu.PopupMenuItem('Help');
        helpItem.connect('activate', () => {
            this._showHelpDialog();
        });
        this._indicator.menu.addMenuItem(helpItem);

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
        let file = Gio.File.new_for_path(GLib.build_filenamev([this.metadata.path, 'bookmarks.json']));
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
        let command = `/usr/bin/google-chrome '${url}'`;
        try {
            GLib.spawn_command_line_async(command);
        } catch (e) {
            this._debugLog(`Failed to open ${url}: ` + e.message);
        }
    }

    // Show the help dialog
    _showHelpDialog() {
        let modal = new ModalDialog.ModalDialog({});
        let mainContentArea = new St.BoxLayout({ vertical: true });
        modal.contentLayout.add(mainContentArea);

        let descriptionLabel = new Clutter.Text({
            text: "Welcome to the Google Meet Extension!\n\n" +
                "With this extension, you can quickly access your Google Meet bookmarks directly from the Gnome Shell panel. " +
                "You can add new bookmarks, manage existing ones, and directly open Meet sessions in your browser.\n\n" +
                "Features:\n" +
                "- 'New Meet': Opens a new Google Meet session in your default browser.\n" +
                "- 'Add': Allows you to add a new bookmark to your Google Meet sessions. Simply provide a name and a unique code.\n" +
                "- 'Help': Brings up this help dialog with information about the extension.\n\n" +
                "To delete a bookmark, simply click on the trash icon next to each bookmark in the menu.\n" +
                "For additional support, please contact the extension developer.",
            line_wrap: true
        });
        mainContentArea.add_child(descriptionLabel);

        modal.addButton({
            label: "Close",
            action: () => {
                modal.close();
            }
        });

        modal.open();
    }


    // Show the add bookmark dialog with input validation
    _showAddDialog() {
        let modal = new ModalDialog.ModalDialog({});

        let titleLabel = new St.Label({ text: "Add New Google Meet Bookmark", style_class: 'modal-title' });
        modal.contentLayout.add_child(titleLabel);

        let mainContentArea = new St.BoxLayout({ vertical: true });
        modal.contentLayout.add(mainContentArea);

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
                    this._addNewBookmark(name, 'https://meet.google.com/' + code);
                    modal.close();
                }
            }
        });

        modal.open();
    }

    // Validate the format of the code
    _validateCodeFormat(code) {
        const regex = /^[a-zA-Z0-9]{3}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{3}$/;
        return regex.test(code);
    }

    // Add a new bookmark and update the menu
    _addNewBookmark(name, code) {
        let newUrl = 'https://meet.google.com/' + code;
        let newBookmark = { name: name, url: newUrl };

        const bookmarksFile = Gio.File.new_for_path(
            GLib.build_filenamev([this.metadata.path, 'bookmarks.json'])
        );

        if (!bookmarksFile.query_exists(null)) {
            let initialContent = JSON.stringify([]);
            let data = new GLib.Bytes(initialContent);
            bookmarksFile.replace_contents(data, null, false, Gio.FileCreateFlags.NONE, null, (res) => {
                try {
                    bookmarksFile.replace_contents_finish(res);
                    this._debugLog('Bookmarks file created.');
                } catch (e) {
                    this._debugLog('Failed to create bookmarks file: ' + e.message);
                }
            });
        }

        this._bookmarks.push(newBookmark);
        this._saveBookmarks();
        this._updateMenu();
    }
}