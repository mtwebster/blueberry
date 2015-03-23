const Applet = imports.ui.applet;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const GnomeBluetooth = imports.gi.GnomeBluetooth;
const Lang = imports.lang;
const St = imports.gi.St;
var ABI=6;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PopupMenu = imports.ui.popupMenu;
const Gio = imports.gi.Gio;

const ConnectionState = {
    DISCONNECTED: 0,
    CONNECTED: 1,
    DISCONNECTING: 2,
    CONNECTING: 3
}

const BUS_NAME = 'org.cinnamon.SettingsDaemon.Rfkill';
const OBJECT_PATH = '/org/cinnamon/SettingsDaemon/Rfkill';

const RfkillManagerInterface = '<node> \
<interface name="org.cinnamon.SettingsDaemon.Rfkill"> \
<property name="BluetoothAirplaneMode" type="b" access="readwrite" /> \
<property name="BluetoothHasAirplaneMode" type="b" access="read" /> \
</interface> \
</node>';

const RfkillManagerProxy = Gio.DBusProxy.makeProxyWrapper(RfkillManagerInterface);

 if (!GnomeBluetooth.hasOwnProperty('KillswitchState')){
     ABI=4;
}

function Source() {
    this._init.apply(this, arguments);
}

Source.prototype = {
    __proto__: MessageTray.Source.prototype,

    _init: function() {
        MessageTray.Source.prototype._init.call(this, _("Bluetooth"));

        this._setSummaryIcon(this.createNotificationIcon());
    },

    notify: function(notification) {
        this._private_destroyId = notification.connect('destroy', Lang.bind(this, function(notification) {
            if (this.notification == notification) {
                // the destroyed notification is the last for this source
                this.notification.disconnect(this._private_destroyId);
                this.destroy();
            }
        }));

        MessageTray.Source.prototype.notify.call(this, notification);
    },

    createNotificationIcon: function() {
        return new St.Icon({ icon_name: 'bluetooth-active',
                             icon_type: St.IconType.SYMBOLIC,
                             icon_size: this.ICON_SIZE });
    }
}

function AuthNotification() {
    this._init.apply(this, arguments);
}

AuthNotification.prototype = {
    __proto__: MessageTray.Notification.prototype,

    _init: function(source, applet, device_path, name, long_name, uuid) {
        MessageTray.Notification.prototype._init.call(this,
                                                      source,
                                                      _("Bluetooth"),
                                                      _("Authorization request from %s").format(name),
                                                      { customContent: true });
        this.setResident(true);

        this._applet = applet;
        this._devicePath = device_path;
        this.addBody(_("Device %s wants access to the service '%s'").format(long_name, uuid));

        this.addButton('always-grant', _("Always grant access"));
        this.addButton('grant', _("Grant this time only"));
        this.addButton('reject', _("Reject"));

        this.connect('action-invoked', Lang.bind(this, function(self, action) {
            switch (action) {
            case 'always-grant':
                this._applet.agent_reply_auth(this._devicePath, true, true);
                break;
            case 'grant':
                this._applet.agent_reply_auth(this._devicePath, true, false);
                break;
            case 'reject':
            default:
                this._applet.agent_reply_auth(this._devicePath, false, false);
            }
            this.destroy();
        }));
    }
}

function ConfirmNotification() {
    this._init.apply(this, arguments);
}

ConfirmNotification.prototype = {
    __proto__: MessageTray.Notification.prototype,

    _init: function(source, applet, device_path, name, long_name, pin) {
        MessageTray.Notification.prototype._init.call(this,
                                                      source,
                                                      _("Bluetooth"),
                                                      _("Pairing confirmation for %s").format(name),
                                                      { customContent: true });
        this.setResident(true);

        this._applet = applet;
        this._devicePath = device_path;
        this.addBody(_("Device %s wants to pair with this computer").format(long_name));
        this.addBody(_("Please confirm whether the PIN '%s' matches the one on the device.").format(pin));

        this.addButton('matches', _("Matches"));
        this.addButton('does-not-match', _("Does not match"));

        this.connect('action-invoked', Lang.bind(this, function(self, action) {
            if (action == 'matches')
                this._applet.agent_reply_confirm(this._devicePath, true);
            else
                this._applet.agent_reply_confirm(this._devicePath, false);
            this.destroy();
        }));
    }
}

function PinNotification() {
    this._init.apply(this, arguments);
}

PinNotification.prototype = {
    __proto__: MessageTray.Notification.prototype,

    _init: function(source, applet, device_path, name, long_name, numeric) {
        MessageTray.Notification.prototype._init.call(this,
                                                      source,
                                                      _("Bluetooth"),
                                                      _("Pairing request for %s").format(name),
                                                      { customContent: true });
        this.setResident(true);

        this._applet = applet;
        this._devicePath = device_path;
        this._numeric = numeric;
        this.addBody(_("Device %s wants to pair with this computer").format(long_name));
        this.addBody(_("Please enter the PIN mentioned on the device."));

        this._entry = new St.Entry();
        this._entry.connect('key-release-event', Lang.bind(this, function(entry, event) {
            let key = event.get_key_symbol();
            if (key == Clutter.KEY_Return) {
                this.emit('action-invoked', 'ok');
                return true;
            } else if (key == Clutter.KEY_Escape) {
                this.emit('action-invoked', 'cancel');
                return true;
            }
            return false;
        }));
        this.addActor(this._entry);

        this.addButton('ok', _("OK"));
        this.addButton('cancel', _("Cancel"));

        this.connect('action-invoked', Lang.bind(this, function(self, action) {
            if (action == 'ok') {
                if (this._numeric) {
                    let num = parseInt(this._entry.text);
                    if (isNaN(num)) {
                        // user reply was empty, or was invalid
                        // cancel the operation
                        num = -1;
                    }
                    this._applet.agent_reply_passkey(this._devicePath, num);
                } else
                    this._applet.agent_reply_pincode(this._devicePath, this._entry.text);
            } else {
                if (this._numeric)
                    this._applet.agent_reply_passkey(this._devicePath, -1);
                else
                    this._applet.agent_reply_pincode(this._devicePath, null);
            }
            this.destroy();
        }));
    },

    grabFocus: function(lockTray) {
        MessageTray.Notification.prototype.grabFocus.call(this, lockTray);
        global.stage.set_key_focus(this._entry);
    }
}

function MyApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
        
        try {                                
            this.metadata = metadata;
            Main.systrayManager.registerRole("bluetooth", metadata.uuid);
            Main.systrayManager.registerRole("bluetooth-manager", metadata.uuid);
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);            
            
            this.set_applet_icon_symbolic_name('bluetooth-disabled');
            this.set_applet_tooltip(_("Bluetooth"));

            this._proxy = new RfkillManagerProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH,
                                                 Lang.bind(this, function(proxy, error) {
                                                     if (error) {
                                                         log(error.message);
                                                         return;
                                                     }
                                                     this.setup_rfkill();
                                                 }));
            this._proxy.connect('g-properties-changed', Lang.bind(this, this._updateKillswitch));

            this._killswitch = new PopupMenu.PopupSwitchMenuItem(_("Bluetooth"), false);
            this.menu.addMenuItem(this._killswitch);

            this._discoverable = new PopupMenu.PopupSwitchMenuItem(_("Visibility"), false);
            this.menu.addMenuItem(this._discoverable);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._fullMenuItems = [new PopupMenu.PopupSeparatorMenuItem(),
                                   new PopupMenu.PopupMenuItem(_("Send Files to Device...")),
                                   new PopupMenu.PopupMenuItem(_("Set up a New Device...")),
                                   new PopupMenu.PopupSeparatorMenuItem()];
            this._hasDevices = false;

            this._fullMenuItems[1].connect('activate', function() {
                GLib.spawn_command_line_async('bluetooth-sendto');
            });
            this._fullMenuItems[2].connect('activate', function() {
                GLib.spawn_command_line_async('bluetooth-wizard');
            });

            for (let i = 0; i < this._fullMenuItems.length; i++) {
                let item = this._fullMenuItems[i];
                this.menu.addMenuItem(item);
            }

            this._client = new GnomeBluetooth.Client();
            this._model = this._client.get_model();
            this._model.connect('row-changed', Lang.bind(this, this._updateDevices));
            this._model.connect('row-deleted', Lang.bind(this, this._updateDevices));
            this._model.connect('row-inserted', Lang.bind(this, this._updateDevices));
log(this._model.length + "  ITEM IN MODEL");
            this._deviceItemPosition = 3;
            this._deviceItems = [];




            // this._applet.connect('notify::show-full-menu', Lang.bind(this, this._updateFullMenu));
            this._updateFullMenu();

            this.menu.addSettingsAction(_("Bluetooth Settings"), 'bluetooth'); 

            // this._applet.connect('pincode-request', Lang.bind(this, this._pinRequest));
            // this._applet.connect('confirm-request', Lang.bind(this, this._confirmRequest));
            // this._applet.connect('auth-request', Lang.bind(this, this._authRequest));
            // this._applet.connect('cancel-request', Lang.bind(this, this._cancelRequest));     
            this._updateDevices();
        }
        catch (e) {
            global.logError(e);
        }
    },

    setup_rfkill: function() {
        this._killswitch.connect('toggled', Lang.bind(this, function() {
            let killed = this._proxy.BluetoothAirplaneMode;
            let has_kill = this._proxy.BluetoothHasAirplaneMode;
            if (has_kill) {
                this._proxy.BluetoothAirplaneMode = !killed;
            } else
                this._killswitch.setToggleState(false);
        }));


        this._client.connect('notify::default-adapter-discoverable', Lang.bind(this, function() {
            this._discoverable.setToggleState(this._client.default_adapter_discoverable);
        }));
        this._discoverable.connect('toggled', Lang.bind(this, function() {
            this._client.default_adapter_discoverable = this._discoverable.state;
        }));

        this._updateKillswitch();
        // this._updateDevices();
    },
    
    on_applet_clicked: function(event) {
        this.menu.toggle();        
    },
    
   
    _updateKillswitch: function() {
        let current_state = this._proxy.BluetoothHasAirplaneMode && this._proxy.BluetoothAirplaneMode;
        let on = !this._proxy.BluetoothAirplaneMode;
        let has_adapter = true;
        let can_toggle = true;
        // on = current_state == GnomeBluetooth.KillswitchState.UNBLOCKED;
		// has_adapter = current_state != GnomeBluetooth.KillswitchState.NO_ADAPTER;
		// can_toggle = current_state != GnomeBluetooth.KillswitchState.NO_ADAPTER &&
			         // current_state != GnomeBluetooth.KillswitchState.HARD_BLOCKED;


// FIXME: need to get adapter status
        this._killswitch.setToggleState(current_state);
        if (can_toggle)
            this._killswitch.setStatus(null);
        else
            /* TRANSLATORS: this means that bluetooth was disabled by hardware rfkill */
            this._killswitch.setStatus(_("hardware disabled"));

        if (has_adapter)
            this.actor.show();
        else
            this.actor.hide();

        if (on) {
            this._discoverable.actor.show();
            this.set_applet_icon_symbolic_name('bluetooth-active');
        } else {
            this._discoverable.actor.hide();
            this.set_applet_icon_symbolic_name('bluetooth-disabled');
        }
    },

    _updateDevices: function() {
        let newlist = [];
        let [ret, iter] = this._model.get_iter_first();
        while (ret) {
            let device = this._model.get_value(iter,
                                               GnomeBluetooth.Column.PROXY);
log(device + " first iter_________________");
            let destroy = true;
            let i = 0;

            for (i = 0; i < this._deviceItems.length; i++) {
                if (device.Address == this._deviceItems[i].Address) {
                    this._updateDeviceItem(this._deviceItems[i], device);
                    destroy = false;
                    break;
                }
            }

            if (destroy && this._deviceItems.length > 0)
                this._deviceItems[i].destroy();
            else
                newlist.push(device);

            ret = this._model.iter_next(iter);
        }

        this._deviceItems = newlist;
        this._hasDevices = newlist.length > 0;


        [ret, iter] = this._model.get_iter_first();
        while (ret) {
            let device = this._model.get_value(iter,
                                               GnomeBluetooth.Column.PROXY);
log(device);
            if (device._item)
                continue;
            let item = this._createDeviceItem(device);
            if (item) {
                this.menu.addMenuItem(item, this._deviceItemPosition + this._deviceItems.length);
                this._deviceItems.push(item);
                this._hasDevices = true;
            }
        }
    },

    _updateDeviceItem: function(item, device) {
        // adopt the new device object
        item._device = device;
        item._connected = device.Connected;
        device._item = item;

        // update properties
        item.label.text = device.Alias;

        // this._buildDeviceSubMenu(item, device);

        // update connected property
        item._connectedMenuitem.setToggleState(device.Connected);
    },

    _createDeviceItem: function(device) {
        let item = new PopupMenu.PopupSubMenuMenuItem(device.Alias);

        // adopt the device object, and add a back link
        item._device = device;
        device._item = item;

        // this._buildDeviceSubMenu(item, device);

        return item;
    },

    _buildDeviceSubMenu: function(item, device) {
        if (device.can_connect) {
            item._connected = device.connected;
            item._connectedMenuitem = new PopupMenu.PopupSwitchMenuItem(_("Connection"), device.connected);
            item._connectedMenuitem.connect('toggled', Lang.bind(this, function() {
                let menuitem = item._connectedMenuitem;
                if (item._connected > ConnectionState.CONNECTED) {
                    // operation already in progress, revert
                    // (should not happen anyway)
                    menuitem.setToggleState(menuitem.state);
                } else
                if (item._connected == ConnectionState.CONNECTED) {
                    item._connected = ConnectionState.DISCONNECTING;
                    menuitem.setStatus(_("disconnecting..."));
                    this._applet.disconnect_device(item._device.device_path, function(applet, success) {
                        if (success) { // apply
                            item._connected = ConnectionState.DISCONNECTED;
                            menuitem.setToggleState(false);
                        } else { // revert
                            item._connected = ConnectionState.CONNECTED;
                            menuitem.setToggleState(true);
                        }
                        menuitem.setStatus(null);
                    });
                } else if (item._connected == ConnectionState.DISCONNECTED) {
                    item._connected = ConnectionState.CONNECTING;
                    menuitem.setStatus(_("connecting..."));
                   this._applet.connect_device(item._device.device_path, function(applet, success) {
                        if (success) { // apply
                           item._connected = ConnectionState.CONNECTED;
                            menuitem.setToggleState(true);
                        } else { // revert
                            item._connected = ConnectionState.DISCONNECTED;
                            menuitem.setToggleState(false);
                        }
                        menuitem.setStatus(null);
                    });
                }
            }));

            item.menu.addMenuItem(item._connectedMenuitem);
        }

        if (device.capabilities & GnomeBluetoothApplet.Capabilities.OBEX_PUSH) {
            item.menu.addAction(_("Send Files..."), Lang.bind(this, function() {
                this._applet.send_to_address(device.bdaddr, device.alias);
            }));
        }
        if (device.capabilities & GnomeBluetoothApplet.Capabilities.OBEX_FILE_TRANSFER) {
            item.menu.addAction(_("Browse Files..."), Lang.bind(this, function(event) {
                this._applet.browse_address(device.bdaddr, event.get_time(),
                    Lang.bind(this, function(applet, result) {
                        try {
                            applet.browse_address_finish(result);
                        } catch (e) {
                            this._ensureSource();
                            this._source.notify(new MessageTray.Notification(this._source,
                                 _("Bluetooth"),
                                 _("Error browsing device"),
                                 { body: _("The requested device cannot be browsed, error is '%s'").format(e) }));
                        }
                    }));
            }));
        }

        switch (device.type) {
        case GnomeBluetoothApplet.Type.KEYBOARD:
            item.menu.addSettingsAction(_("Keyboard Settings"), 'keyboard');
            break;
        case GnomeBluetoothApplet.Type.MOUSE:
            item.menu.addSettingsAction(_("Mouse Settings"), 'mouse');
            break;
        case GnomeBluetoothApplet.Type.HEADSET:
        case GnomeBluetoothApplet.Type.HEADPHONES:
        case GnomeBluetoothApplet.Type.OTHER_AUDIO:
            item.menu.addSettingsAction(_("Sound Settings"), 'sound');
            break;
        default:
            break;
        }
    },

    _updateFullMenu: function() {
        // if (this._applet.show_full_menu) {
        //     this._showAll(this._fullMenuItems);
        //     if (this._hasDevices)
        //         this._showAll(this._deviceItems);
        // } else {
        //     this._hideAll(this._fullMenuItems);
        //     this._hideAll(this._deviceItems);
        // }
    },

    _showAll: function(items) {
        for (let i = 0; i < items.length; i++)
            items[i].actor.show();
    },

    _hideAll: function(items) {
        for (let i = 0; i < items.length; i++)
            items[i].actor.hide();
    },

    _destroyAll: function(items) {
        for (let i = 0; i < items.length; i++)
            items[i].destroy();
    },

    _ensureSource: function() {
        if (!this._source) {
            this._source = new Source();
            if (Main.messageTray) Main.messageTray.add(this._source);
        }
    },

    _authRequest: function(applet, device_path, name, long_name, uuid) {
        this._ensureSource();
        this._source.notify(new AuthNotification(this._source, this._applet, device_path, name, long_name, uuid));
    },

    _confirmRequest: function(applet, device_path, name, long_name, pin) {
        this._ensureSource();
        this._source.notify(new ConfirmNotification(this._source, this._applet, device_path, name, long_name, pin));
    },

    _pinRequest: function(applet, device_path, name, long_name, numeric) {
        this._ensureSource();
        this._source.notify(new PinNotification(this._source, this._applet, device_path, name, long_name, numeric));
    },

    _cancelRequest: function() {
        this._source.destroy();
    },
    
    on_applet_removed_from_panel: function() {
        Main.systrayManager.unregisterId(this.metadata.uuid);
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    let myApplet = new MyApplet(metadata, orientation, panel_height, instance_id);
    return myApplet;      
}
